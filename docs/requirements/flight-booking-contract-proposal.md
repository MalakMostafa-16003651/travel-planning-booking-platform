# Flight Booking and Inventory Holds: shared contract

Status: **proposal, not yet agreed.** Person 4 needs answers from Person 3 (flights
and cabins), Person 8 (payments and refunds), Person 6 (shared booking status) and
Person 2 (notifications and admin views). The module in `backend/src/flight-bookings`
is built against this proposal so work can continue in parallel. Anything the team
changes here is updated in its `adapters/` folder or `flight-booking.rules.ts`.

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

All routes require `AuthGuard`. Booking and cancelling are limited to role `USER`.
Every query is scoped to `request.user.userId`; another user's booking returns 404.

| Method | Endpoint | Requirement | Behavior |
| --- | --- | --- | --- |
| POST | `/api/flight-bookings` | FLT-19, FLT-21 | Validate passengers and baggage, return the priced summary. Reserves and stores nothing. |
| POST | `/api/flight-bookings/hold` | FLT-22 | Same body. Recomputes the price, reserves seats, creates a `PENDING` booking, returns it with `holdExpiresAt`. 409 if seats are insufficient. |
| GET | `/api/flight-bookings` | FLT-25 | Own bookings, `?group=UPCOMING\|PAST\|CANCELLED`, page size 10 (GEN-05). |
| GET | `/api/flight-bookings/:id` | FLT-25 | Full details, including refund status. |
| GET | `/api/flight-bookings/:id/cancellation-quote` | FLT-26 | Refund percentage and amount, changes nothing. Added so the user sees the refund before confirming. |
| POST | `/api/flight-bookings/:id/cancel` | FLT-26 | Cancels and requests the refund. |
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

Person 4 will export, for Person 3:

```ts
cancelBookingsForFlight(flightId): Promise<void>          // FLT-06: 100% refund, release holds
syncFlightSchedule(flightId, departureAt, arrivalAt): Promise<void> // FLT-05: call on any time change
findConfirmedUserIdsForFlight(flightId): Promise<string[]> // FLT-05: schedule-change notice
listBookingsForFlight(flightId, page): Promise<Page>       // FLT-29, without passport numbers
```

### Person 8: Payments and Refunds

Person 4 will export:

```ts
getPayableBooking(flightBookingId, userId): Promise<{ amount, currency, holdExpiresAt }>
confirmPaidBooking(flightBookingId, paymentId): Promise<void> // Idempotent; Stripe webhooks may repeat.
```

Person 4 needs from `PaymentsService`:

```ts
cancelPendingPayment({ bookingType: 'FLIGHT', bookingId }): Promise<void> // PAY-01, on hold expiry
createRefund({ bookingType: 'FLIGHT', bookingId, amount, reason }): Promise<{ refundId }> // PAY-03
```

`createRefund` must be idempotent per booking, because failed requests are retried
every minute. Person 8 blocks payment until policies are accepted (PAY-02), so booking
code does not read that record.

If a payment succeeds after its booking expired, `confirmPaidBooking` throws
`ConflictException` and Person 8 must refund that payment in full.

Until `PaymentsService` exists, nothing calls `confirmPaidBooking`, so bookings can be
held but not confirmed outside the automated tests.

### Persons 1 and 2

- `NotificationsService.create({ userId, type, message })` for GEN-01.
- Person 4 will export `hasUpcomingConfirmedBookings(userId)` for ACC-12 and a
  read-only booking list for ACC-17.
- `validationException` in `configure-application.ts` reads only top-level
  constraints, so errors inside `passengers[]` come back as an empty list. GEN-02
  needs nested messages, so Person 1 should agree to that fix.

## 6. Consistency approach

- **Hold, confirm and cancel** run in a MongoDB transaction, because round trips
  touch two cabins plus the booking. Atlas supports this. Tests need a replica set
  rather than the current standalone in-memory server.
- **Expiry** uses a sweeper every minute that atomically moves overdue `PENDING`
  bookings to `EXPIRED`, releases seats and cancels the PaymentIntent. Payment
  checks `holdExpiresAt` directly, so a late sweep cannot extend a hold.
- **Completion** moves `CONFIRMED` to `COMPLETED` after the last segment departs.

## 7. Decisions needed

| # | Question | Who | Proposal |
| --- | --- | --- | --- |
| 1 | Are the section 5 field names acceptable? | Person 3 | Yes, as listed. |
| 2 | How is money stored, and in which single currency (PAY-04)? | Persons 3, 6, 8 | Integer minor units (cents), matching Stripe and avoiding rounding errors. `USD` is a placeholder in `flight-booking.rules.ts`. |
| 3 | Add `COMPLETED` and `EXPIRED` as in section 3? | Person 6 | Yes, keeping `PENDING` as Pending Payment. |
| 4 | Refund status: the sheet (PAY-03) says Pending, Refunded, Failed, but the team enum says `SUCCEEDED`. | Person 8 | Follow the sheet and use `REFUNDED`. |
| 5 | Where is policy acceptance stored? | Person 8 | On Person 8's side, which also blocks payment until it exists. |
| 6 | Is round-trip baggage charged per segment? The sheet is silent. | Team | Yes, per passenger per segment. |
| 7 | Which date decides passenger type? The sheet is silent. | Team | Age on the outbound departure date. |
| 8 | How are "days remaining" counted for tiers? The sheet is silent. | Persons 6, 8 | Whole 24-hour periods before departure, rounded down. |
| 9 | May infants add extra baggage? The sheet is silent. | Team | Yes, under the same limit. |
| 9a | Is there a limit on passengers per booking? The sheet is silent. | Team | 50, only as a safety bound on request size. |
| 10 | Who owns the role guard? `AuthGuard` exists, but no roles guard does yet. | Person 1 | Person 1 adds it. Person 4 checks `role` inline until then. |
| 11 | Add a PDF library for e-tickets (for example `pdfkit`)? | Team | Yes. |
| 12 | `AI_PROMPTS.txt`: the PDF requires this root file, but `develop` removed it in favor of `docs/work-logs/` with TA confirmation pending. | Team leader | Confirm with the TA which file counts. |
