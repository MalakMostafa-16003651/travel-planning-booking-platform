# Flight Booking and Inventory Holds: shared contract

Status (updated 2026-11-10): **in use.** The module in `backend/src/flight-bookings`
was merged in PR #8 and is now bound to the real Payments (Person 8) and
Notifications (Person 2) services. Person 3's Flights schemas match section 5
exactly. Section 7 records which decisions the team adopted. Anything the team
changes here is updated in the `adapters/` folder or `flight-booking.rules.ts`.

Sources: `Final_ SP1_Reviewed_Requirements.xlsx` (authoritative), the project PDF
section 8.4, and the team's naming rules. Bonus FLT-27 and FLT-28 are out of scope.

## 1. Requirements owned by Person 4

| ID | Required behavior |
| --- | --- |
| FLT-19 | Enter each passenger's full name, date of birth and passport/ID number. Optionally add extra baggage per passenger up to the airline maximum. Baggage fees join the total. |
| FLT-21 | Show a summary (flight, passengers, baggage, total) before payment. |
| FLT-22 | On proceeding to payment, atomically reserve seats only if enough remain, and create a Pending Payment booking held for 10 minutes. On timeout it becomes Expired and seats are released. Concurrent requests never oversell. |
| FLT-23 | After successful payment: Confirmed, held seats become booked seats, unique reference, in-app notification, downloadable PDF e-ticket. |
| FLT-25 | List own bookings grouped as Upcoming, Past and Cancelled, and open full details. |
| FLT-26 | Cancel own Confirmed booking before departure, after viewing the refund from the airline's tiers. Seats return and a refund is created. Blocked after departure. |
| FLT-12 (booking part) | Round trip is one booking, two segments, one payment, one reference, cancelled as a whole on the outbound tier. Adults and children pay the fare and take a seat. Infants pay 10% and take no seat. At least one adult, and no more infants than adults. Type is validated against date of birth. |
| GEN-11 | Pending Payment -> Confirmed -> Completed, plus Pending Payment -> Expired and Confirmed -> Cancelled. No other transitions. |

## 2. API

All routes use Person 1's `AuthGuard` and `RolesGuard` with `@Roles(UserRole.USER)`:
other roles get 403. Every query is scoped to `request.user.userId`; another user's
booking returns 404. Admins and moderators read bookings through ACC-17 and FLT-29.

| Method | Endpoint | Requirement | Behavior |
| --- | --- | --- | --- |
| POST | `/api/flight-bookings` | FLT-19, FLT-21 | Validate passengers and baggage, return the priced summary. Reserves and stores nothing. |
| POST | `/api/flight-bookings/hold` | FLT-22 | Same body. Recomputes the price, reserves seats, creates a `PENDING` booking, returns it with `holdExpiresAt`. 409 if seats are insufficient. |
| GET | `/api/flight-bookings` | FLT-25 | Own bookings, `?group=UPCOMING\|PAST\|CANCELLED`, page size 10 (GEN-05). |
| GET | `/api/flight-bookings/:id` | FLT-25, PAY-03 | Full details. Once a refund exists, `refund` holds `{ refundId, status, amount, currency }` from Payments, with status `PENDING`, `REFUNDED` or `FAILED`. |
| GET | `/api/flight-bookings/:id/cancellation-quote` | FLT-26 | Refund percentage and amount, changes nothing. Added so the user sees the refund before confirming. |
| POST | `/api/flight-bookings/:id/cancel` | FLT-26 | Cancels and requests the refund. The refund is quoted inside the transaction, and the write only matches while the outbound departure is still ahead by database time, so a slow lookup can never commit after departure. |
| GET | `/api/flight-bookings/:id/e-ticket` | FLT-23 | PDF download, Confirmed bookings only. |

Why `POST /api/flight-bookings` stores nothing: GEN-11 starts the lifecycle at
Pending Payment, so a stored draft would add a state the sheet does not allow.

## 3. Shared enum

Add once, in `backend/src/common/enums/booking-status.enum.ts`, for both booking
modules. The team rules allow adding sheet-required statuses to the shared enum.

```ts
export enum BookingStatus {
  PENDING = 'PENDING', // GEN-11 "Pending Payment"
  CONFIRMED = 'CONFIRMED',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}
```

## 4. FlightBooking model (Person 4)

| Field | Meaning |
| --- | --- |
| `userId` | Owner. |
| `segments[]` | One or two: `flightId`, `airlineId`, `cabinId`, `cabinClass`, `fare`, plus flight number, airport codes, times and time zones. Copied at hold time, so later price edits do not affect the booking (FLT-05). Times stay current through `syncFlightSchedule`. |
| `lastDepartureAt` | Departure of the final segment, used to group and complete bookings. |
| `refundDue` | True until Payments accepts the refund, so a failed request is retried. |
| `passengers[]` | Embedded `Passenger`, with `_id` exposed as `passengerId`: `fullName`, `dateOfBirth`, `documentNumber`, `type` (`ADULT`, `CHILD`, `INFANT`), `extraBags`, `extraBaggageWeightKg`. |
| `seatCount` | Adults plus children. Infants are excluded. |
| `baggageFee`, `totalAmount`, `currency` | Fixed at hold time, in the single platform currency (PAY-04). |
| `status` | `BookingStatus`. |
| `holdExpiresAt` | Hold time plus 10 minutes, for `PENDING` bookings. |
| `bookingReference` | Unique sparse index. Generated on confirmation only (FLT-23). |
| `paymentId`, `refundId` | References to Person 8's records. |
| `cancelledAt`, `cancelledBy`, `refundAmount` | `cancelledBy` is `USER` or `AIRLINE`. |

## 5. What Person 4 needs from others

### Person 3: Flight and CabinInventory

Person 3 owns the schemas. Person 4 reads these exact fields from the default Mongoose
collections, and is the only writer of `heldSeats` and `bookedSeats` once a booking
exists. `cabinId` is the `CabinInventory` document's `_id`, and references are stored
as ObjectIds.

| Entity (collection) | Fields needed |
| --- | --- |
| `CabinInventory` (`cabininventories`) | `flightId`, `cabinClass`, `totalSeats`, `heldSeats`, `bookedSeats`, `price`, `baggageMaxWeightKg` |
| `Flight` (`flights`) | `airlineId`, `flightNumber`, `status` (`SCHEDULED`, `CANCELLED`, `DEPARTED`), `departureAt`, `arrivalAt` (UTC), `departureAirportId`, `arrivalAirportId` |
| `Airport` (`airports`) | `code` (IATA), `timeZone` (IANA) |
| `Airline` (`airlines`) | `isActive` (ACC-15), `baggagePolicy: { pricePerExtraBag, maxExtraBagsPerPassenger }`, `cancellationTiers: [{ daysBeforeDeparture, refundPercentage }]` |

If these names change, only `adapters/mongo-flight-inventory.adapter.ts` changes.

Available seats are `totalSeats - bookedSeats - heldSeats`, as FLT-11 defines. The
seat update is one conditional document write, so oversell is impossible even
without a transaction:

```ts
cabins.updateOne(
  { _id: cabinId, $expr: { $gte: [{ $subtract: ['$totalSeats', { $add: ['$bookedSeats', '$heldSeats'] }] }, seatCount] } },
  { $inc: { heldSeats: seatCount } },
);
```

FLT-05 seat-count edits by Person 3 need the same kind of conditional write, or a
reduction can race a hold.

Person 4 exports, for Person 3:

```ts
cancelBookingsForFlight(flightId): Promise<void>          // FLT-06: 100% refund, release holds, notify; safe to retry
syncFlightSchedule(flightId, departureAt, arrivalAt): Promise<void> // FLT-05: call on any time change
findConfirmedUserIdsForFlight(flightId): Promise<string[]> // FLT-05: schedule-change notice
listBookingsForFlight(flightId, page): Promise<Page>       // FLT-29, without passport numbers
```

### Person 8: Payments and Refunds

Payments reads bookings through `getMine` (section 8) and calls:

```ts
confirmPaidBooking(flightBookingId, paymentId): Promise<void> // Idempotent for the same paymentId, including after COMPLETED.
```

`BOOKING_PAYMENTS` is bound to Person 8's `BookingPaymentsAdapter`
(`useExisting`, with `forwardRef(() => PaymentsModule)`):

```ts
cancelPendingPayment({ bookingType: 'FLIGHT', bookingId }): Promise<void> // PAY-01, on hold expiry
createRefund({ bookingType: 'FLIGHT', bookingId, amount, reason }): Promise<{ refundId }> // PAY-03, minor units
getRefundStatus({ bookingType: 'FLIGHT', bookingId }): Promise<{ refundId, status, amount, currency } | null> // PAY-03
```

`createRefund` is idempotent per booking and reason, because failed requests are
retried every minute. Keep the two reason strings unchanged ("Booking cancelled by
the user" and "Flight cancelled by the airline"). Person 8 blocks payment until
policies are accepted (PAY-02). If a payment succeeds after its booking expired,
`confirmPaidBooking` throws `ConflictException` and Payments refunds it in full.

### Persons 1 and 2

- `BOOKING_NOTIFICATIONS` is bound to Person 2's `NotificationsService`, whose
  `notify({ userId, type, message })` accepts this port's input unchanged (GEN-01).
- ACC-12: `hasUpcomingConfirmedBookings(userId, session?)`, and Person 1's
  `UsersService.acquireBookingGate` inside the confirmation transaction, as agreed in
  the authentication contract.
- ACC-17: `listForAdmin({ status, from, to, page })`.
- ACC-15: `listConfirmedUserIdsForAirline(airlineId)`, as Person 2 asked in the admin
  contract.
- Nested validation errors such as `passengers.0.fullName` were fixed by Person 1.

## 6. Consistency approach

- **Hold, confirm and cancel** run in a MongoDB transaction, because round trips
  touch two cabins plus the booking. Atlas supports this. Tests need a replica set
  rather than the current standalone in-memory server.
- **Expiry** uses a sweeper every minute that atomically moves overdue `PENDING`
  bookings to `EXPIRED`, releases seats and cancels the PaymentIntent. Payment
  checks `holdExpiresAt` directly, so a late sweep cannot extend a hold.
- **Completion** moves `CONFIRMED` to `COMPLETED` after the last segment departs.

## 7. Decisions

| # | Question | Outcome |
| --- | --- | --- |
| 1 | Section 5 field names | **Adopted.** Person 3's schemas match exactly. |
| 2 | Money and currency (PAY-04) | **Adopted.** Integer minor units in `USD`. `PLATFORM_CURRENCY` in `flight-booking.rules.ts` is imported by Hotel Bookings and Payments, so do not move or rename it. |
| 3 | `COMPLETED` and `EXPIRED` | **Adopted** in the shared `BookingStatus` (GEN-11). |
| 4 | Refund status values | **Adopted:** `PENDING`, `REFUNDED`, `FAILED`, as in PAY-03. |
| 5 | Policy acceptance | **Adopted:** stored and enforced by Payments (PAY-02). |
| 6 | Round-trip baggage per segment | Proposal in use; no objection recorded. |
| 7 | Passenger type by outbound departure date | Proposal in use; no objection recorded. |
| 8 | Whole 24-hour days for tiers | Proposal in use; Payments shows the same tiers. |
| 9 | Infant extra baggage allowed | Proposal in use; no objection recorded. |
| 9a | At most 50 passengers per booking | Proposal in use, as a request-size bound only. |
| 10 | Role guard | **Done:** Person 1's `RolesGuard` replaced the inline check. |
| 11 | `pdfkit` for e-tickets | Merged in PR #8. |
| 12 | AI log location | **Team decision:** one log per student in `docs/work-logs/` (Person 4: `16002979.md`). TA confirmation of the PDF's `AI_PROMPTS.txt` name is still pending. |

## 8. Stable interface for ITN-27 (Person 7)

Person 7's ITN-27 bonus reads flight bookings through `getMine(flightBookingId, userId)`,
which returns the owner's booking or throws 404. These fields are treated as stable:
Person 4 tells Person 7 before renaming or removing any of them.

- `status`, `totalAmount`, `currency`, `bookingReference`
- `segments[]`: `flightNumber`, `departureAirportCode`, `arrivalAirportCode`,
  `departureAt` (UTC), `departureTimeZone` (IANA)

`totalAmount` is an integer in minor units of `USD` (PAY-04), so `totalAmount / 100`
is the amount in dollars, as the e-ticket and Payments already show it. Local
departure dates come from `departureAt` with `departureTimeZone`, not the UTC date.
