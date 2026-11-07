# Hotels, Rooms and Availability: shared contract

Status: **proposal, not yet agreed.** Person 5 (Lama) owns `backend/src/hotels`.

Audit update (2026-11-07): this proposal does not yet cover the complete official
hotel requirements. Reconcile it with the
[Milestone 1 ownership matrix](milestone-1-ownership-matrix.md) before HotelBooking
is built against it. The reviewed workbook also requires hotel photos/star
class/amenities, room type/beds/name uniqueness, positive bookable ranges,
reservation-safe room deactivation, country-only search, rating filters/sorting
and complete room/availability responses. This notice records those gaps; it
does not approve a replacement shared schema. Lama and Osama must coordinate
the corrected availability/reservation interface under the team's existing rules.

This mirrors the pattern Person 3 used for Person 4 (see the
[flight booking contract](flight-booking-contract-proposal.md)): the schemas and
collection/field names below are the integration surface. HotelBooking (Person 6)
does not exist yet; this module is built so Person 6 can write their own adapter
against these collections later, the same way `MongoFlightInventoryAdapter` reads
`flights`/`cabininventories` without Person 3 writing it for them.

Sources: the project PDF (14 pages, section 8.5/8.6; the 2026-11-06 revision
highlights HTL-09/HTL-10 and the provider-deactivation note in section 8.2), the
reviewed requirements workbook (HTL-01 through HTL-26), and the team's naming
rules in `docs/work-logs/16003651.md` section 4.

## 1. Requirements owned by Person 5

| ID | Required behavior |
| --- | --- |
| HTL-01 | Hotel profile: name, destination (city/country), description, address. Admin creates (mirrors `POST /api/airlines`); the assigned moderator edits their own. |
| HTL-02 | Public hotel detail view. |
| HTL-03, HTL-05, HTL-06 | Create/update/remove individually bookable rooms: capacity, pricing. Removal is a soft deactivation, not a hard delete, so existing/past bookings keep a valid reference. |
| HTL-04, HTL-05, HTL-06 | Moderator-set blocked dates per room. |
| HTL-08 | Read a room's availability/blocked ranges for a date window. |
| HTL-09, HTL-10 | **Highlighted PDF change.** `PUT /api/hotels/:id/policies`: cancellation tiers and check-in/check-out times. |
| HTL-11, HTL-12, HTL-15 | Search hotels by destination/dates/guest count with filtering and sorting; list a hotel's available rooms for a stay. |
| HTL-22 | Moderator view of their hotel's reservations. Depends on Person 6's `HotelBooking`; built last, behind a pending adapter (see section 5). |
| ACC-15 (shared) | `isActive` on `Hotel`, exactly like `Airline.isActive`. A deactivated hotel is hidden from search/detail for guests and cannot be newly booked; its existing Confirmed reservations remain valid (highlighted PDF note, section 8.2). Toggling `isActive` is Person 2's admin endpoint; Person 5 only reads/enforces it. |

Out of scope here: HTL-16/18/20/21/23/24/26 (reservations and reviews) belong to
Person 6.

## 2. API

| Method | Endpoint | Requirement | Who |
| --- | --- | --- | --- |
| POST | `/api/hotels` | HTL-01 | ADMIN |
| GET | `/api/hotels/:id` | HTL-02 | anyone (404 if inactive and caller is not the assigned moderator/admin) |
| PATCH | `/api/hotels/:id` | HTL-01 | assigned HOTEL_MODERATOR, own hotel only |
| PUT | `/api/hotels/:id/policies` | HTL-09, HTL-10 | assigned HOTEL_MODERATOR |
| POST | `/api/hotels/:id/rooms` | HTL-03 | assigned HOTEL_MODERATOR |
| PATCH | `/api/hotels/:id/rooms/:roomId` | HTL-05 | assigned HOTEL_MODERATOR |
| DELETE | `/api/hotels/:id/rooms/:roomId` | HTL-06 | assigned HOTEL_MODERATOR (soft deactivate) |
| POST | `/api/hotels/:id/rooms/:roomId/availability` | HTL-04 | assigned HOTEL_MODERATOR (block dates) |
| PATCH | `/api/hotels/:id/rooms/:roomId/availability` | HTL-05, HTL-06 | assigned HOTEL_MODERATOR (unblock/edit) |
| GET | `/api/hotels/:id/availability` | HTL-08 | assigned HOTEL_MODERATOR |
| GET | `/api/hotels/:id/rooms/available` | HTL-15 | anyone, given `checkIn`/`checkOut`/`guests` |
| GET | `/api/hotels/search` | HTL-11, HTL-12 | anyone |
| GET | `/api/hotels/:id/reservations` | HTL-22 | assigned HOTEL_MODERATOR (deferred, see section 5) |

`:id` routes are used literally, as the PDF lists them, rather than Airlines'
`/me` pattern: ownership is enforced by comparing `:id` to the moderator's
assigned `hotelId`, so a stale `:id` from another hotel returns 404/403 the same
way `getOwnedScheduledFlight` does for flights.

## 3. Schemas (Person 5)

### Hotel (`hotels`)

| Field | Meaning |
| --- | --- |
| `name` | Trimmed, 2-120 chars. |
| `cityId`, `countryCode` | Resolved through the shared `ReferenceDataService` (`resolveCity`), the same official catalog itineraries already use, so ITN-25 and hotel search agree on what a "city" is. |
| `address` | Free text. |
| `description` | Optional, max 2000 chars. |
| `isActive` | Default `true`. Mirrors `Airline.isActive`; ACC-15 toggles it. |
| `checkInTime`, `checkOutTime` | `HH:mm`, defaults `14:00`/`11:00`. |
| `cancellationPolicy.tiers[]` | `{ daysBeforeCheckIn, refundPercentage }`, same shape as `Airline.cancellationTiers`. |

### Room (`rooms`)

| Field | Meaning |
| --- | --- |
| `hotelId` | Ref `Hotel`, indexed. |
| `name` | e.g. "Deluxe King", free text (no official room-type enum in the workbook). |
| `capacity` | Max guests, integer ≥ 1. |
| `pricePerNight` | Integer minor units, same open currency question as `CabinInventory.price` (PAY-04, pending with Person 8). |
| `isActive` | Soft-delete flag for HTL-06. |

### RoomAvailability (`roomavailabilities`) — one document per room

Each room is individually bookable (PDF 6.3), so availability is a yes/no per
date range rather than a seat count. Proposed shape, **one document per
`roomId`** (unique index), so a hold/release is a single conditional write
exactly like `CabinInventory`'s seat counters:

```ts
{
  roomId: ObjectId,           // unique
  hotelId: ObjectId,          // denormalized, for moderator queries
  blockedRanges: [{ startDate, endDate, reason? }],   // moderator-set, HTL-04/05/06
  bookedRanges:  [{ startDate, endDate, status: 'HELD' | 'BOOKED', holdExpiresAt?, hotelBookingId }],
}
```

`startDate`/`endDate` are `YYYY-MM-DD`, half-open (`endDate` is checkout, the
night before is the last booked night). A range overlaps `[startDate, endDate)`
when `existing.startDate < endDate AND existing.endDate > startDate`.

Person 6's future hold (mirroring `reserveSeats`) is one atomic update:

```ts
roomavailabilities.updateOne(
  {
    roomId,
    blockedRanges: { $not: { $elemMatch: { startDate: { $lt: endDate }, endDate: { $gt: startDate } } } },
    bookedRanges:  { $not: { $elemMatch: { startDate: { $lt: endDate }, endDate: { $gt: startDate } } } },
  },
  { $push: { bookedRanges: { startDate, endDate, status: 'HELD', holdExpiresAt, hotelBookingId } } },
);
```

No overlap exists → the filter matches → the push happens. An overlap exists →
`modifiedCount === 0` → booking fails with 409, nothing changes. A multi-room
booking (HTL-16/18, "handled consistently as one operation") wraps one such
update per room in a single MongoDB transaction, the same way round-trip flight
holds touch two cabins in one transaction.

Person 5 writes `blockedRanges` (HTL-04/05/06) and reads both arrays for
HTL-08/HTL-15/search. Person 5 never writes `bookedRanges`; that belongs to
Person 6's booking module once it exists, same division as
Person 3/`cabininventories.heldSeats`.

## 4. What Person 5 needs from others

### ModeratorAssignment (Person 2, still pending — see `docs/work-logs/16003651.md` line 809)

Same temporary pattern as `AirlinesService.getAssignedAirlineId`: read the raw
`moderatorassignments` collection (`moderatorId`, `hotelId`), documented in the
[authentication contract](authentication-contract-proposal.md#moderatorassignment).
`HotelsService.getAssignedHotelId(moderatorId)` is the Hotels-side copy of that
adapter; it moves to a shared service if/when Person 2 ships one.

### ReferenceDataService (Person 7, shipped)

`resolveCity(name, countryCode?)`, `assertCountries(codes)` from
`backend/src/reference-data`. Hotel destinations and search queries both resolve
through this service so ITN-25 and `GET /api/hotels/search` agree on what counts
as a matching city.

### Person 8 (Payments, not shipped)

Same open question as flights: `pricePerNight`'s currency (PAY-04). Using
integer minor units as a placeholder, consistent with `CabinInventory.price`.

## 5. What Person 5 exports for others

### Person 6 (HotelBooking, not shipped)

- The `rooms` and `roomavailabilities` collections/fields in section 3, to read
  and write directly (their own adapter owns `bookedRanges`).
- `HotelsService.getAssignedHotelId(moderatorId)` for their moderator-scoped
  reservation views.
- `cancelReservationsForRoom`-style hooks are **not** built yet; add them when
  Person 6's module exists, the same way Person 3 left room for Person 4's
  `cancelBookingsForFlight`.

Until Person 6 ships, HTL-22 (`GET /api/hotels/:id/reservations`) follows the
itinerary precedent: a `HotelReservationsPort` with a `PendingReservationsAdapter`
that throws 503, swapped for a real adapter once Person 6's service exists.

### Person 7 (Itineraries, shipped, already waiting on this)

`ItineraryHotelSearch { city, countryCode?, checkIn, checkOut, guests, rooms, page? }`
from `backend/src/itineraries/ports/travel-search.port.ts` must be satisfiable by
`HotelsService.search(...)`. Section 2's `GET /api/hotels/search` query shape
matches those fields exactly so Person 7's adapter is a direct pass-through once
written; no changes requested to that port.

## 6. Decisions needed

| # | Question | Who | Proposal |
| --- | --- | --- | --- |
| 1 | Is the one-document-per-room `blockedRanges`/`bookedRanges` shape acceptable, instead of a document-per-date calendar? | Person 6 | Yes — it keeps holds to one conditional write, matching the flights precedent, and avoids a multi-year date-row seed. |
| 2 | Currency for `pricePerNight`? | Person 8 | Integer minor units, same placeholder status as flights (PAY-04 still open). |
| 3 | Room type: free text or an enum? | Team | Free text; the workbook does not define a fixed room-type list. |
| 4 | Who flips `Hotel.isActive`? | Person 2 | Admin endpoint writes the field directly, same as the (also unbuilt) Airline equivalent; Hotels only enforces it. |
| 5 | `AI_PROMPTS.txt` vs `docs/work-logs/`: same open team question as the other contracts. | Team leader | Follow whatever the TA confirms for the rest of the team. |
