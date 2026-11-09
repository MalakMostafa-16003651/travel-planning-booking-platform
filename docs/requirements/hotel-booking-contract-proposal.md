# Hotel Bookings and Reviews: shared contract

Status (updated 2026-11-08): **partly implemented; the remaining parts wait on other owners.**
Person 6 (Osama, 16005523) owns `backend/src/hotel-bookings` and `backend/src/reviews`. The plan,
endpoints and integration approach were approved by the team leader on 2026-11-08 (section 2). The schemas
and exported methods below are the integration surface for Lama (Person 5), Omar (Person 8), Arwa
(Person 2) and Malak (Person 1).

| State | PR | What it delivers |
| --- | --- | --- |
| Merged | [#50](https://github.com/MalakMostafa-16003651/travel-planning-booking-platform/pull/50) | This contract proposal and the student work log. |
| Merged | [#51](https://github.com/MalakMostafa-16003651/travel-planning-booking-platform/pull/51) | `HotelBooking` schema, `GET /api/hotel-bookings` and `GET /api/hotel-bookings/:id` (owner only), `listForHotel` (HTL-22, mapped by Malak's adapter from #55) and `listForAdmin` (ACC-17, connected by Arwa in #53). |
| Merged | [#52](https://github.com/MalakMostafa-16003651/travel-planning-booking-platform/pull/52) | `Review` schema, `POST /api/hotel-bookings/:id/review`, `PATCH`/`DELETE /api/reviews/:id`, `GET /api/hotels/:id/reviews` with average and count on read, the GEN-09/10 hooks and `getRatingStats`. |
| Merged | [#54](https://github.com/MalakMostafa-16003651/travel-planning-booking-platform/pull/54) | UTC "today" (L2) through `HotelBookingsClock`, UPCOMING/PAST groups, the CONFIRMED → COMPLETED sweep (GEN-11) and `hasUpcomingConfirmedBookings` (ACC-12). |
| In review | [#56](https://github.com/MalakMostafa-16003651/travel-planning-booking-platform/pull/56) | `POST /api/hotel-bookings`: validated multi-room request, one-transaction 10-minute holds with 409 on any overlap, and the expiry sweep (HTL-16, HTL-18). |
| Waiting for Omar | PR 4, PR 5 | Payment confirmation, notification and PaymentIntent cancellation on expiry (HTL-17); cancellation quote, cancel and refund (HTL-21). See questions O1-O6. |
| Optional, last | PR 6 | HTL-26 review replies (bonus). |

Anything still open is listed in section 7 and is not built until the owner agrees.

Sources: the reviewed requirements workbook as quoted in the
[Milestone 1 ownership matrix](milestone-1-ownership-matrix.md) (HTL-16/17/18/20/21/23/24, HTL-26 bonus,
GEN-05, GEN-11, PAY-01..04, ACC-11/12/15/17, GEN-09/10), the project PDF section 8.6, the
[hotel contract](hotel-contract-proposal.md), the [flight booking contract](flight-booking-contract-proposal.md)
(the pattern mirrored here), the [admin contract](admin-contract-proposal.md), the
[authentication contract](authentication-contract-proposal.md) and the team naming rules in
[16003651.md](../work-logs/16003651.md) section 4.

## 1. Requirements owned by Person 6

| ID | Required behavior |
| --- | --- |
| HTL-16 | A registered user books one or more available rooms in the same hotel for the same dates in one reservation, assigning adults and children (ages 0-17) to each room, with at least one adult per reservation. No room's guests may exceed its maximum occupancy. Total = sum over rooms of nights x that room's price at booking time. |
| HTL-18 | All selected rooms are held together for 10 minutes as one Pending Payment reservation. If any room overlaps a Confirmed reservation, an unexpired hold or a blocked range, the whole request is rejected and nothing is held. Unpaid holds become Expired and the rooms are released. Check-out after check-in; check-in not in the past. |
| HTL-17 | After verified payment the whole reservation becomes Confirmed, gets a unique booking reference and the user receives an in-app notification. (The confirmation page is Milestone 2.) |
| HTL-20 | Own reservations grouped as Upcoming, Past and Cancelled (reference, hotel, rooms, dates, guests, total, status) and full details. |
| HTL-21 | The owner cancels a Confirmed reservation as a whole before the check-in date, after seeing the refund computed from the hotel's tiers (HTL-10) on the full total. It becomes Cancelled, all rooms are released and a refund is created (PAY-03). No partial cancellation. |
| HTL-23 | A Confirmed reservation becomes Completed once its check-out date has passed. One rating (1-5) and optional review (max 1000 characters) per Completed reservation, regardless of the number of rooms; the owner can edit or delete it. The average rating follows. |
| HTL-24 | Anyone sees a hotel's average rating, number of ratings and reviews (newest first, paginated). |
| GEN-11 (hotel part) | PENDING -> CONFIRMED -> COMPLETED, PENDING -> EXPIRED and CONFIRMED -> CANCELLED are the only transitions. |
| HTL-26 (bonus) | A hotel moderator replies to a review. Optional, built last. |

Person 6 also **supplies data** for HTL-22 (Lama's moderator reservations view), ACC-11, ACC-12, ACC-17
and GEN-09/10 (reviews), and the rating statistics for HTL-02/HTL-12. Person 6 does not build those
endpoints; each owner connects the exported method on their side.

## 2. Team-leader decisions (approved 2026-11-08)

- The plan, endpoints and integration approach below are approved.
- The extra `GET /api/hotel-bookings/:id/cancellation-quote` is approved (same as flights), so the user sees
  the refund before confirming (HTL-21).
- EXPIRED reservations are listed under the CANCELLED group (same as flights).
- The average rating is calculated on read from `reviews`; nothing is stored on `Hotel`.
- The time zone for "check-in not in the past" and "before check-in" is **agreed with Lama first**, one
  approach for both modules (section 7, question L2). Person 6 does not pick one alone.
- The room availability contract is finalised with Lama before holds are built (PR 3).
- Payment failure, expiry and refund behaviour is agreed with Omar before PRs 4 and 5.

### Person 6 (student) decisions for `POST /api/hotel-bookings` (2026-11-08)

These are the student's own decisions, not workbook rules:

- **At most 10 rooms per reservation.** The workbook sets no maximum; this is a safety bound on request size, the same idea as the flight module's passenger limit. A larger request is a 400.
- **At least one guest in every room.** HTL-16 assigns guests to each room, so a room with no adults and no children is a 400. The workbook's "at least one adult per reservation" is kept as is, so a room may hold only children.
- **404 for what cannot be booked.** An unknown or deactivated hotel (ACC-15), and a room that is unknown, inactive or of another hotel, return 404, like flight bookings ("Flight or cabin not found") and the hotel detail. Real input errors (dates, guests, capacity, repeated rooms, malformed ids) stay 400.
- **A stay is finished on its check-out date** (Upcoming/Past, completion, ACC-12), consistent with Lama's half-open ranges where the check-out night is free. Left open for the team leader's confirmation in #54.

## 3. API

All `/api/hotel-bookings` routes use Person 1's `AuthGuard`. Booking, cancelling and reviewing use
`RolesGuard` + `@Roles(UserRole.USER)`. Every booking query is scoped to `request.user.userId`; another
user's reservation answers **404**, as for flight bookings (ACC-11). Lists have page size 10 (GEN-05).

| Method | Endpoint | Req | Behavior |
| --- | --- | --- | --- |
| POST | `/api/hotel-bookings` | HTL-16, HTL-18 | Validate rooms/guests/dates, price from current room prices, hold all rooms in one transaction, create a `PENDING` reservation with `holdExpiresAt`. 409 on any overlap. |
| GET | `/api/hotel-bookings` | HTL-20 | Own reservations, `?group=UPCOMING\|PAST\|CANCELLED&page=`. EXPIRED is in CANCELLED. |
| GET | `/api/hotel-bookings/:id` | HTL-20 | Full details of an own reservation, including refund status. |
| GET | `/api/hotel-bookings/:id/cancellation-quote` | HTL-21 | Days before check-in, refund percentage and amount. Changes nothing. |
| POST | `/api/hotel-bookings/:id/cancel` | HTL-21 | Cancels the whole reservation, releases rooms, requests the refund. |
| POST | `/api/hotel-bookings/:id/review` | HTL-23 | One review per COMPLETED own reservation; 409 on a second one. |
| PATCH | `/api/reviews/:id` | HTL-23 | Author only. |
| DELETE | `/api/reviews/:id` | HTL-23 | Author only. |
| GET | `/api/hotels/:id/reviews` | HTL-24 | Public. Newest first, paginated, with `averageRating` and `ratingCount`. Hidden reviews excluded. |
| POST | `/api/reviews/:id/reply` | HTL-26 | Bonus, assigned HOTEL_MODERATOR of that hotel only. |

`/api/hotels/:id/reviews` is served by `ReviewsController` in Person 6's module, not by Lama's
`HotelsController`; Lama's files are not changed.

Payment and policy endpoints (`/api/bookings/:type/:id/policies`, `/accept-policies`, `/api/payments`)
belong to Omar. Hotel reservations reach them only through his ports and adapters.

## 4. Schemas (Person 6)

Money is integer **minor units** in the single platform currency **USD** (PAY-04), the same as flights.
Dates are `YYYY-MM-DD` strings, half-open `[checkIn, checkOut)`, the same convention as
`RoomAvailability`. Shared enums only: `BookingStatus`, `UserRole`.

### HotelBooking (`hotelbookings`)

| Field | Meaning |
| --- | --- |
| `userId` | Owner (ObjectId). Indexed with `status`. |
| `hotelId` | The one hotel of the reservation, top-level so Arwa's ACC-15 query (`status: CONFIRMED, hotelId`) and Lama's HTL-22 view can filter on it. |
| `hotelName`, `checkInTime`, `checkOutTime` | Snapshot at hold time, for the summary and lists (HTL-09 times shown on the booking summary). |
| `rooms[]` | One entry per room: `roomId`, `roomName` and `pricePerNight` (snapshot), `adults` (>= 0), `childrenAges[]` (integers 0-17), `subtotal` = nights x `pricePerNight`. At least one adult across the reservation; each room's guests <= its capacity at hold time. |
| `checkIn`, `checkOut` | `YYYY-MM-DD`, `checkIn < checkOut`. |
| `nights` | `checkOut - checkIn` in days. |
| `totalPrice`, `currency` | Sum of `rooms[].subtotal`; `currency` is `USD`. Fixed at hold time (HTL-05: price edits do not affect reservations). |
| `status` | `BookingStatus`. |
| `holdExpiresAt` | Hold time + 10 minutes while `PENDING`. |
| `bookingReference` | Unique sparse index; generated only on confirmation (HTL-17). |
| `paymentId` | Omar's `Payment._id`, set on confirmation. |
| `policySnapshot` | `{ cancellationTiers[{daysBeforeCheckIn, refundPercentage}], checkInTime, checkOutTime }` copied at hold time, so the policy shown before payment (PAY-02) is the one applied. Whether the live or the snapshot tiers apply at cancellation is question O5. |
| `cancelledAt`, `cancelledBy`, `refundAmount`, `refundDue`, `refundId` | Cancellation and refund tracking, as in `FlightBooking`. `refundDue` stays true until Payments accepts the refund, so a failed request is retried. |
| `completedAt` | Set by the completion sweep (GEN-11). |

Indexes: `{ userId: 1, status: 1, checkIn: 1 }`, `{ hotelId: 1, status: 1 }`, `{ status: 1, holdExpiresAt: 1 }`,
`{ bookingReference: 1 }` unique sparse.

### Review (`reviews`)

| Field | Meaning |
| --- | --- |
| `userId` | Author. |
| `hotelId` | Indexed with `createdAt` for the public newest-first list. |
| `hotelBookingId` | **Unique**: one review per reservation; a second one is 409. |
| `rating` | Integer 1-5. |
| `comment` | Optional, max 1000 characters. |
| `isHidden` | Default `false`. Set only through `setReviewHidden` (GEN-10). |
| `reply` | HTL-26 bonus only: `{ moderatorId, text, createdAt }`. |

The author's display name is read on each request through Malak's `UsersService.getDisplayNames`; a
DEACTIVATED author is returned as **"Deleted user"** (ACC-12). Nothing is copied into the review.

## 5. Lifecycle and consistency (planned, mirroring flight bookings)

- **Hold (PR 3):** one MongoDB transaction that loads the hotel (must be `isActive`, ACC-15) and rooms (same
  hotel, `isActive`, capacity), pushes one `HELD` range per room into `roomavailabilities.bookedRanges` with
  a conditional write, and creates the `PENDING` booking. Any conditional write that matches nothing aborts
  the transaction: 409 and nothing held.
- **Confirm (PR 4):** after Omar's verified webhook. Conditional on `PENDING` and `holdExpiresAt > now`;
  `HELD` ranges become `BOOKED`; reference generated; safe to repeat for the same `paymentId`; 409 when the
  hold has ended so Omar refunds that payment. BOOKING_CONFIRMED notification after commit.
- **Expire (PR 4):** a one-minute sweep moves overdue `PENDING` to `EXPIRED`, removes the `HELD` ranges and
  asks Omar to cancel the PaymentIntent.
- **Complete (PR 1):** the sweep moves `CONFIRMED` to `COMPLETED` once the check-out date has passed. The
  exact "passed" boundary depends on question L2.
- **Cancel (PR 5):** owner, `CONFIRMED`, before the check-in date; whole reservation; `BOOKED` ranges removed;
  refund requested after commit with retry; BOOKING_CANCELLED notification.
- External calls (Stripe through Omar, notifications) never run inside a database transaction; a failed
  notification never undoes a committed change.

## 6. Interfaces with other owners

### Exported by Person 6 (`HotelBookingsModule` exports `HotelBookingsService`, `ReviewsModule` exports `ReviewsService`)

Each owner connects these on their own side; Person 6 does not edit their modules or adapters.

| Consumer | Method | Purpose |
| --- | --- | --- |
| Omar (PAY-01/02) | `getPayable(hotelBookingId, userId)` | Owner-only; 404 otherwise. Returns status, `totalPrice` (minor units), currency, `holdExpiresAt`, hotel cancellation tiers and check-in/check-out times for PAY-02. Omar's adapter converts to major units for `PayableBooking`. |
| Omar (PAY-01) | `confirmPaidBooking(hotelBookingId, paymentId)` | Idempotent per `paymentId`; 409 if the hold ended. |
| Omar (PAY-01) | `markPaymentFailed(hotelBookingId, paymentId)` | Proposal: no state change; the reservation stays `PENDING` until its hold ends (same as flights). |
| Lama (HTL-22) | `listForHotel(hotelId, page)` | Reservations of one hotel (guest, dates, rooms, status), page size 10. Lama checks moderator ownership and binds it in place of `PendingHotelReservationsAdapter`. |
| Lama (HTL-02, HTL-12) | `ReviewsService.getRatingStats(hotelIds)` | `Map<hotelId, { averageRating, ratingCount }>`, visible reviews only; unrated hotels absent. |
| Lama (HTL-06) | `hasActiveReservationsForRoom(roomId)` / `roomHasEverBeenReserved(roomId)` | Proposal, see question L5. |
| Arwa (ACC-17) | `listForAdmin({ status, from, to, page })` | Read-only, same shape as `FlightBookingsService.listForAdmin`. |
| Arwa (ACC-15) | collection `hotelbookings`, fields `hotelId`, `userId`, `status` | Her `confirmedCustomerIds` query for hotel deactivation notices. |
| Arwa (GEN-09/10) | `ReviewsService.reviewExists(id)`, `setReviewHidden(id, hidden)`, `adminDeleteReview(id)` | Same three operations as Omar's posts/comments; 404 when the review does not exist. |
| Malak (ACC-12) | `hasUpcomingConfirmedBookings(userId)` | True if a `CONFIRMED` reservation has not checked out yet (includes ongoing stays). |

### Needed by Person 6

| Owner | Needed | Status on develop 2026-11-08 |
| --- | --- | --- |
| Malak | `AuthGuard`, `RolesGuard`, `@Roles`, `UsersService.getDisplayNames` | Merged; reused, not copied. |
| Lama | `Hotel` (`isActive`, `checkInTime`, `checkOutTime`, `cancellationTiers`), `Room` (`capacity`, `pricePerNight`, `isActive`), `RoomAvailability.bookedRanges`, `HotelsService.getAssignedHotelId` | Merged. Positive bookable ranges (HTL-04) and a time zone are **missing** (questions L1, L2). |
| Omar | A hotel `BookingsPort` adapter in `payments/`, hotel policies in `PoliciesService`, PaymentIntent cancellation on expiry and idempotent refunds for hotel reservations | **Missing**: `PaymentsModule` binds `BOOKINGS_PORT` to `FlightBookingsAdapter` only, which returns null for hotels. |
| Arwa | `NotificationsService.notify` with `BOOKING_CONFIRMED`, `BOOKING_CANCELLED` | Merged. |

## 7. Open questions

### Lama (Person 5): must be agreed before PR 3 (holds)

| # | Question | Proposal |
| --- | --- | --- |
| L1 | HTL-04 requires positive, non-overlapping bookable date ranges. `RoomAvailability` only has `blockedRanges`/`bookedRanges`. What field and shape will hold them? | **Decided by Lama 2026-11-08:** there is no separate bookable-ranges list. A room is free for `[checkIn, checkOut)` when nothing in `blockedRanges` or `bookedRanges` overlaps (`startDate < checkOut && endDate > checkIn`), the same rule as `HotelsService.isRoomFree`. Half-open: the check-out night is not blocked. |
| L2 | Time zone for "check-in not in the past", "before the check-in date", tier days, Upcoming/Past and completion. `Hotel` and `City` have no time-zone field. | **Decided by Lama 2026-11-08:** "today" is the server's current UTC calendar date (`new Date().toISOString().slice(0, 10)`), compared with stay dates as `YYYY-MM-DD` strings. No client-local time. The helper lives in Person 6's `hotel-bookings` module only (`hotel-booking.dates.ts`, `todayUtc`). |
| L3 | The contract's hold filter rejects any overlapping `bookedRanges` entry, including expired `HELD` ones, and `HotelsService.isRoomFree` treats them as taken. HTL-18 only blocks *unexpired* holds. | **Decided by Lama 2026-11-08:** her search does not check `holdExpiresAt`, so an expired `HELD` entry blocks the room until Person 6 removes it. Person 6's hold (a) `$pull`s expired `HELD` entries for those rooms inside the same transaction before checking, and (b) runs an expiry sweep every minute that sets `PENDING` reservations past `holdExpiresAt` to `EXPIRED` and `$pull`s their `HELD` entries. Cancelling Omar's open payment on expiry is added later, in PR 4. |
| L4 | A `RoomAvailability` document exists only after a moderator first blocks dates. May the hold create it (idempotent `$setOnInsert` upsert, the same pattern as `blockDates`)? | Yes, from Person 6's own adapter inside `hotel-bookings/`, writing only `bookedRanges`. |
| L5 | HTL-06: "reject deactivation/blocking that overlaps a Confirmed or Pending reservation" can use `bookedRanges`; "deletion only if never reserved" cannot, because ranges are removed on cancel/expiry. | Person 6 exports `roomHasEverBeenReserved(roomId)` from `hotelbookings`. |
| L6 | HTL-22 multi-room reservation response. | **Approved by Malak in the ACC-11 session:** use rooms[] (roomId, roomName, adults, childrenAges), guestCount and bookingReference. Keep userId, dates, status, currency, totalAmount (mapped from totalPrice) and pagination. The adapter resolves guestName using UsersService; booking/payment/policy/private profile documents are not exposed. Prepared on feature/ACC-11-provider-booking-access; available after review/merge. |
| L7 | Room `type` and `beds` (HTL-03) are not on `Room` yet. | Snapshotted into `rooms[]` once they exist. |
| L8 | `DATE_ONLY` accepts impossible dates such as 2027-02-31 (audit F5). | Person 6's DTOs validate real calendar dates; one shared helper if Lama prefers. |

### Omar (Person 8): must be agreed before PRs 4 and 5

| # | Question | Proposal |
| --- | --- | --- |
| O1 | Who adds the hotel side of `BOOKINGS_PORT`? | Omar, in `payments/adapters/`, calling `getPayable`/`confirmPaidBooking`/`markPaymentFailed`. |
| O2 | Payment failure | No state change; the user may retry until the hold ends (PAY-01). |
| O3 | Hold expiry | Person 6's sweep marks `EXPIRED`, releases rooms, then calls Omar's `cancelPendingPayment('hotel', hotelBookingId)` through a port in Person 6's module that Omar implements. A success after expiry gets 409 from `confirmPaidBooking`, and Omar refunds it in full. |
| O4 | Refunds | Person 6 calls `createRefund({ bookingType: 'hotel', bookingId, amount, reason })` after commit, amount in minor units; it must be idempotent per reservation because failed requests are retried every minute. Refund status is shown on the reservation details. |
| O5 | Which tiers apply at cancellation: the snapshot accepted before payment, or the hotel's current tiers? | Snapshot, so the user gets the policy they accepted (PAY-02). Needs Omar's and Lama's agreement. |
| O6 | Days before check-in for tier selection | Depends on L2; same selection rule as FLT-09. |

### Arwa (Person 2), Malak (Person 1) and the team leader

| # | Question | Proposal |
| --- | --- | --- |
| A1 | Review moderation hooks and ACC-17 query shape as in section 6 | Arwa wires them in `ContentModerationService` and `AdminBookingsService` after PRs 1/2 merge. |
| A2 | Should the author still see their own hidden review (GEN-10: visible to author and admins)? | **Decided by the student 2026-11-08:** the same pattern as Omar's `CommentsService`. In `GET /api/hotels/:id/reviews` a hidden review is listed only for its own author and for admins, with `isHidden: true`; guests and other users never see it. Hidden reviews never count in the average or the count. The route uses optional authentication, as the blog does (Person 7's `OptionalAuthGuard`, reused unchanged). Implemented in PR 2. |
| M1 | ACC-12: is an ongoing stay "upcoming"? Order of a late payment confirmation versus deactivation? | Ongoing stays block deactivation. Confirmation ordering to be agreed with Malak and Omar. |
| T1 | Notifications: call `NotificationsService` directly, or through a port like flights? | Pending the student's decision. |
| T2 | Tier rule: reuse `refundPercentageFor` from `flight-booking.rules.ts` (it reads `daysBeforeDeparture`) or a hotel version in Person 6's module? | Pending the student's decision. |
| T3 | `GET /api/hotels/:id/reviews` for a deactivated hotel | **Decided by the student 2026-11-08:** 404, exactly like the hotel detail. The route calls Lama's `HotelsService.getById`, so an unknown or deactivated hotel is 404 for guests and users, while admins and the assigned moderator still see it. Implemented in PR 2. |

## 8. Delivery plan (one PR per step, each from current develop)

| PR | Branch | Content | Dependencies |
| --- | --- | --- | --- |
| 0 | `docs/HTL-16-hotel-booking-contract` | This proposal and the work log. | None. |
| 1 | `feature/HTL-20-hotel-booking-records` | Schema, own list/detail, `listForHotel`, `listForAdmin`, `hasUpcomingConfirmedBookings`, completion sweep. | Upcoming/Past grouping and the sweep wait for L2. |
| 2 | `feature/HTL-23-hotel-reviews` | Reviews, public list with average/count, moderation and rating-stat exports. | PR 1. |
| A | `feature/HTL-20-booking-groups` | UTC today helper, UPCOMING/PAST groups, CONFIRMED to COMPLETED sweep, `hasUpcomingConfirmedBookings` (ACC-12). | L2 (decided 2026-11-08). |
| B | `fix/HTL-22-reservations-port-shape` | **Dropped 2026-11-08, never opened.** Superseded by the team leader's approved and merged L6 (PR #55): `listForHotel` keeps its reservation shape and Malak's adapter in `HotelsModule` maps it. The branch was deleted. | — |
| 3 | `feature/HTL-16-hotel-booking` | `POST /api/hotel-bookings` with transactional holds, expired-hold cleanup, expiry sweep and concurrency tests. | L1-L3 and L2 decided 2026-11-08. |
| 4 | `feature/HTL-17-hotel-booking-payment` | Payment integration, confirmation, notification, expiry. | O1-O3 agreed and Omar's hotel support merged. |
| 5 | `feature/HTL-21-hotel-booking-cancel` | Quote, cancel, room release, refund, notification. | O4-O6 agreed and merged. |
| 6 | `feature/HTL-26-review-replies` | Bonus, only after everything mandatory. | PR 2. |


Session publication (2026-11-08): [PR55](https://github.com/MalakMostafa-16003651/travel-planning-booking-platform/pull/55) contains the approved ACC-11 integration and ACC-07 backend. The team leader requested merging the saved edits. Use the PR record for the final merge state; tests/setup limits remain as documented. Before merging Osama's separate fix/HTL-22-reservations-port-shape branch, reconcile its per-room roomId/guests output with this approved rooms[]/guestCount/bookingReference contract.
