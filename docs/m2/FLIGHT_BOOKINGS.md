# Flight bookings frontend (Ismail, Person 4)

Requirements: FLT-19, FLT-21, FLT-22, FLT-23, FLT-25, FLT-26, GEN-11 and bonus FLT-27.
Feature folder: `frontend/src/features/flight-bookings`. Shared components:
`frontend/src/components/booking`.

## Routes and rendering

| Route | Purpose | Rendering and why |
| --- | --- | --- |
| `/bookings` | Hub: next flight and group totals | Dynamic SSR. Private, read fresh with the traveler's cookies, never cached |
| `/bookings/flights/new?selection=` | Travelers, baggage, server price, hold | Dynamic SSR shell (session, live flights) around a client form |
| `/bookings/flights?group=&page=` | Upcoming, Past, Cancelled, ten per page | Dynamic SSR. The group and page live in the URL |
| `/bookings/flights/[id]` | Status, hold timer, payment link, refund, cancellation | Dynamic SSR with client actions; every action re-reads the server |
| `/bookings/flights/[id]/ticket` | Confirmation and e-ticket | Dynamic SSR. Shown only from the server's own status |
| `/bookings/flights/[id]/change?change=` | FLT-27 search, quote and confirmation | Dynamic SSR shell around client search |

Nothing here is static or ISR: every page depends on the signed-in traveler. Only the
public airport catalog is cached (five minutes, like the backend's own header). Private
pages are `noindex`. Guests go to sign-in and come back (ACC-10); other roles see Access
denied; another traveler's booking is Not found (ACC-11).

## Contracts

| With | Contract | State |
| --- | --- | --- |
| Gamila, selection | `/bookings/flights/new?selection=<encoded JSON>` with `{ segments: [{ flightId, cabinId }], adults, children, infants }` (issue #131) | Joined and tested with the merged results page: search, selection, sign-in return, family round trip and sell-out |
| Gamila, search | `searchHref` builds `/flights?…` with her `criteriaToParams`, so Back to flights and Search flights again restore the trip and travelers | Ready |
| Gamila, SeatSelector | `SeatSelectorProps` in `seat-selection.tsx`: her proposed props, presentation only. `SeatSelection` loads the map and saves | Data layer ready; not mounted until her component exists |
| Hicham, checkout | Links to `/checkout/flight/{flightBookingId}` and `/checkout/flight-change/{flightBookingChangeId}`. After payment send the traveler to `/bookings/flights/{id}/ticket` or the change page | Links ready; route pending |
| Hicham, refund status | `refund-status.tsx` shows the booking's own refund until `PaymentRefundStatus` exists | Pending |
| Osama, Hicham | `BookingStepper`, `HoldTimer`, `BookingStatusBadge`, `BookingLifecycle` from `@/components/booking` | Ready, examples at `/dev/ui/booking` |
| Osama, hub | Hotel summary below the flight groups on `/bookings` | Pending |
| Malak | `BookingEmailGate` around hold, payment and change actions (issue #127) | Integrated |

**Why seats are saved by the booking page:** `PUT /flight-bookings/:id/seats` replaces the
choices for every future flight of the booking. A selector that saved only its own flight
would erase the other one, so the booking page saves both together.

### HoldTimer

`<HoldTimer expiresAt serverNow onExpire? label? expiredLabel? />`. Pass the server's time
at render as `serverNow`: the countdown runs from the difference, so a wrong device clock
cannot change it. `onExpire` fires once. Re-read the booking there: the countdown never
releases stock and never confirms anything.

### BookingStepper

`<BookingStepper steps={[{ id, label, href? }]} current label? />`. Only finished steps with
an `href` become links.

## Rules worth knowing

- **Money:** every booking, quote and change amount is integer USD cents. The one exception
  on these pages is `GET /bookings/flight-change/:id/policies`, which is in dollars.
- **Prices:** totals come from `POST /flight-bookings`, the hold or the change. Line items
  only explain the total and disappear if they do not add up to it.
- **One hold:** a double click sends one request. If the answer is lost, the page looks for
  the hold before allowing a retry, and it offers a live hold for the same flights.
- **Travel documents** stay in memory only. They are never written to browser storage, and
  booking pages mask them.
- **Times:** each end of a flight uses its own airport's zone (GEN-06).
- **Ticket page:** checks the server every four seconds for at most two minutes while
  payment is being verified, so an open tab cannot keep an idle session alive.

## GEN-11 lifecycle checklist

Co-verifiers: Osama (hotel holds) and Hicham (payments and refunds).

| Transition | Trigger | Flight UI | Flight proof | Hotel (Osama) | Payment (Hicham) |
| --- | --- | --- | --- | --- | --- |
| new to Pending Payment | Hold created | Timer and payment link | Browser test | Pending | Not applicable |
| Pending to Confirmed | Verified webhook only | Ticket page appears by itself | Browser test with a signed webhook | Pending | Browser test (checkout suite): result page confirms only after the signed webhook, from the booking status; flight, hotel and flight-change |
| Pending to Expired | 10 minutes without payment | Timer ends, payment link removed, seats released | Browser test | Pending | Browser test: expired hold blocks paying; a success webhook after expiry is refunded in full and never shown as confirmed |
| Confirmed to Cancelled (traveler) | Confirmed before departure | Quote, confirmation, refund status | Browser test | Pending | Browser test: an old result link shows paid-then-cancelled with the refund. `PaymentRefundStatus` ready to mount in place of `refund-status.tsx` |
| Confirmed to Cancelled (airline) | Gamila's FLT-06 | "The airline cancelled this flight" and refund | Backend test only | Not applicable | Backend test only (M1 refunds suite, 100% refund) |
| Confirmed to Completed | Last flight departed | Moves to Past, ticket stays | Backend test only | Pending | Not applicable |
| Any other change | Not allowed | Actions hidden, server refuses | Browser test after departure | Pending | Browser test: checkout shows already paid / cancelled and the server refuses a second payment |

Since 25 November the airline cancellation (through the real moderator endpoint, with the
full refund) and the move to Completed also have flight browser tests in
`tests-bookings/search-to-booking.spec.ts`.

Booking status and refund status are separate: a Cancelled booking can have a Pending,
Refunded or Failed refund.

## Running the checks

```bash
npm --prefix ../backend run build
```

```bash
npm --prefix ../backend run build:test
```

```bash
npm run build
```

```bash
npx playwright test -c playwright.bookings.config.ts
```

From `frontend/`. Set `PLAYWRIGHT_CHANNEL=chrome` to use installed Chrome. The suite starts
the real Nest app on a throwaway MongoDB replica set on ports 3110 and 3111. It never reads
`.env` or touches Atlas, mail or Stripe. Only Stripe's network calls are faked; webhooks are
signed and verified.

## Known limits

- The payment pages are Hicham's. Until they are merged, the payment links lead to Not found.
- A pending change has no "find my change" endpoint. Its id is kept in the URL and in this
  tab. If both are lost, the replacement hold ends by itself within 10 minutes.
- Flight, airport and selection types and the airport-time formatters come from Gamila's
  `lib/flights`. `features/flight-bookings/types.ts` keeps only the booking responses.
- Arwa's shared pagination will replace the previous/next links.
