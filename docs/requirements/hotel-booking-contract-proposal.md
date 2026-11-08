# Hotel Bookings and Reviews: shared contract

Status: **proposal, not yet agreed.** Person 6 (Osama, 16005523) owns `backend/src/hotel-bookings` and
`backend/src/reviews`. No code exists yet. The plan, endpoints and integration approach were approved by
the team leader on 2026-11-08 (section 2). The schemas and exported methods below are the integration
surface for Lama (Person 5), Omar (Person 8), Arwa (Person 2) and Malak (Person 1). Anything still open
is listed in section 7 and is not built until the owner agrees.

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
