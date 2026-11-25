# Payments frontend (Hicham, Person 8)

Requirements: PAY-01, PAY-02, PAY-03, PAY-04 and the payment path of bonus FLT-27.
Feature folder: `frontend/src/features/payments`. Backend contract: `backend/src/payments`.

## Routes and rendering

| Route | Purpose | Rendering and why |
| --- | --- | --- |
| `/checkout/flight/[flightBookingId]` | Policies, acceptance and card payment for a held flight | Dynamic SSR (`force-dynamic`, every read `no-store`) around a client form |
| `/checkout/hotel/[hotelBookingId]` | The same for a held hotel booking | Same |
| `/checkout/flight-change/[flightBookingChangeId]` | The fare difference of a higher-fare change | Same |
| `/checkout/result?type=&bookingId=&paymentId=` | Waits for the backend to confirm the payment | Dynamic SSR for the first status, then a client watch |

Nothing here is static or ISR: the amount, policies, hold and status belong to one signed-in
traveler and change by the second. The server reads them with the traveler's own cookies
(`features/payments/server.ts`) and never caches them. Pages are `noindex`. Any other `type`, or an id
that is not an ObjectId, is Not found. Guests go to sign in and come back (ACC-10); other roles see
Access denied, because only role USER can pay; another traveler's booking or payment is Not found
(ACC-11).

### How a payment works

1. **Review policies (PAY-02).** `GET /api/bookings/:type/:id/policies` gives the policies, the amount
   and the currency. The traveler ticks the box and presses Accept policies:
   `POST /api/bookings/:type/:id/accept-policies` with `{ accepted: true }`. The page then shows
   "Policies accepted on <date and time>" from the stored `acceptedAt`. Until then Pay is disabled, and
   the backend refuses payment with a 409.
2. **Pay (PAY-01).** Inside `BookingEmailGate`, checkout sends `POST /api/payments` with
   `{ bookingType, bookingId }` only. The amount always comes from the booking. The answer's
   `clientSecret` goes straight to Stripe Elements (`<Elements>` + `<PaymentElement>`), and
   `stripe.confirmPayment({ redirect: 'if_required' })` sends the card to Stripe. Card details never
   reach our frontend server or backend.
3. **Confirmation.** A resolved `confirmPayment` is **not** a success. Checkout opens
   `/checkout/result`, which reads `GET /api/payments/:id` every 2 seconds for about a minute. The
   backend changes the status only from the signed webhook, or by asking Stripe itself while the
   payment is PENDING. SUCCEEDED shows "Payment confirmed" and the continue link. FAILED shows the
   `failureReason` and Try again. Still PENDING after a minute shows "still processing" and Check
   again (a late webhook). Stripe's redirect query (`payment_intent`, `redirect_status`) is ignored.

**Retrying.** After a declined card, Try again first reads `GET /api/payments/:id`, so the backend
records the decline, then calls `POST /api/payments` again. For a FAILED payment the backend answers
409 "The last payment failed. Use POST /api/payments/<id>/retry"; checkout takes the id from that
message (a small commented regex, it is our own message) and calls the retry route, which gives a new
PaymentIntent on the same Payment. This also covers a reload or the result page's Try again.

**Hold expiry.** `HoldTimer` gets `serverNow` from the server render. When it reaches zero, checkout
disables payment and refreshes the page; only the server decides whether the hold ended. An ended hold
shows "Your hold has expired" with a link back to the booking. The countdown never claims anything by
itself.

**Double submission.** Accept and Pay are disabled while they run. A successful card submission stays
locked while the result page opens. After any error the traveler can act again.

## Contracts

| With | Contract | State |
| --- | --- | --- |
| Ismail, links in | `/checkout/flight/{flightBookingId}` and `/checkout/flight-change/{flightBookingChangeId}` (issue #140) | Implemented |
| Ismail, return pages | Paid flight: `/bookings/flights/{flightBookingId}/ticket` (it waits for the webhook itself). Leaving or expired: `/bookings/flights/{flightBookingId}`. Paid change: `/bookings/flights/{flightBookingId}/change?change={flightBookingChangeId}`; the booking id is read from `GET /api/flight-booking-changes/{id}` | Implemented |
| Ismail, equal or lower fare | Never sent to checkout. If it arrives, checkout shows "Nothing to pay for this change" and links to the change page | Implemented |
| Osama, hotels | Links in: `/checkout/hotel/{hotelBookingId}`. Return page: `/bookings/hotels/{hotelBookingId}` (his reserved route). A 503 "Hotel checkout is temporarily unavailable" is shown as an error | Implemented; his pages are pending, so the return link is Not found until they are merged |
| Ismail, Osama, status | `PaymentRefundStatus` from `@/features/payments` (see below), to replace `features/flight-bookings/refund-status.tsx` | Ready, examples at `/dev/ui/payments` |
| Ismail | `BookingStepper`, `HoldTimer`, `effectiveStatus` from `@/components/booking` | Used |
| Malak | `BookingEmailGate` around payment and `isEmailVerificationRequiredError` for its 403 | Used |
| Arwa and every money consumer | `MONEY_FIELDS` and the formatters in `features/payments/money.ts` | Ready |

### PaymentRefundStatus

```tsx
import { PaymentRefundStatus } from '@/features/payments';

<PaymentRefundStatus paymentId={booking.paymentId} refundId={booking.refundId} currency={booking.currency} />
```

`{ paymentId?: string; refundId?: string; currency?: string }`. A client component. It loads
`GET /api/payments/:id` and `GET /api/refunds/:id` and shows a badge with words (not only colour) and
the amount for each: Payment processing, Paid, Payment failed (with the reason) or Payment refunded,
and Refund pending, Refunded or Refund failed. Check again reloads both. With neither id it shows
"No payment yet". `currency` is only a fallback; each document has its own. `PaymentRefundStatusView`
is the same display without loading, for galleries and tests.

### Other exports

From `@/features/payments`: `PolicyDetails({ type, policies, currency, airlineLabels? })`,
`checkoutPath`, `resultPath`, `checkoutLinks`, the money helpers below, and the wire types
(`Payment`, `Refund`, `BookingPolicies`, `CheckoutType`...). Server reads stay in
`features/payments/server.ts` and are not exported from the index.

## Money: field-to-unit map (PAY-04)

`MONEY_FIELDS` in `features/payments/money.ts` is the single record. It wraps
`formatMoneyMinorUnits`/`formatMoneyMajorUnits` from `lib/format/money.ts`, which are unchanged.

| Endpoint | Fields | Unit |
| --- | --- | --- |
| `GET /api/payments/:id`, `POST /api/payments`, `POST /api/payments/:id/retry` | `amount` (`payment.amount`) | Major (dollars) |
| `GET /api/refunds/:id` | `amount` | Major |
| `GET /api/bookings/:type/:id/policies` | `amount`, `policies.baggage[].pricePerExtraBag`, `policies.change.*` | Major |
| `GET /api/flight-bookings/:id` | `totalAmount`, `baggageFee`, `segments[].fare`, `refundAmount`, `refund.amount` | Minor (cents) |
| `GET /api/flight-booking-changes/:id` | `previousAmount`, `totalAmount`, `differenceAmount`, `amountToPay`, `refundAmount`, `refund.amount` | Minor |
| `GET /api/hotel-bookings/:id` | `totalPrice`, `rooms[].pricePerNight`, `rooms[].subtotal`, `refundAmount` | Minor |

Helpers: `formatPaymentAmount(payment)`, `formatRefundAmount(refund)`, `formatPolicyAmount(policies)`,
`formatBookingCents(value, currency)` and `formatMoney(value, unit, currency)`. The refund embedded in
a flight booking is cents; the Refund document for the same refund is dollars. Never convert twice.

## Environment

`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in `frontend/.env.local` (see `.env.example`): the Stripe
**publishable** test key, `pk_test_...`. Publishable keys are public by design; the secret key and
webhook secret stay in `backend/.env`. Next fixes `NEXT_PUBLIC_` values when `next build` (or
`next dev`) starts, so restart or rebuild after changing it. Without it, checkout shows "Payments are
not configured" instead of a card form.

## How to test

### Automatic

From `frontend/`, after building the backend once:

```bash
npm --prefix ../backend run build
```

```bash
npm --prefix ../backend run build:test
```

```bash
npx playwright test -c playwright.checkout.config.ts
```

The config builds Next with a placeholder publishable key and starts `scripts/payments-backend.cjs`:
the real Nest app on a throwaway MongoDB replica set (ports 3120 and 3121), with the backend's
FakeStripe and signed, verified webhooks. js.stripe.com is not reachable in CI, so the spec serves a
tiny fake Stripe.js through `page.route`. Set `PLAYWRIGHT_CHROMIUM_PATH` to use a preinstalled
Chromium, or `PLAYWRIGHT_CHANNEL=chrome` for installed Chrome. The harness is a copy of Ismail's
`flight-bookings-backend.cjs` with two more controls (read a booking's payment, signed failure
webhook); his file is unchanged.

Covered: guest sign-in and return; Pay disabled until the policies are accepted, with the accepted
time shown; a double-clicked Pay confirms once; success only after the signed webhook, then the ticket
link; a declined card, then a retry with a new PaymentIntent; a failed payment on the result page and
its retry through checkout; an expired hold, also one that ends while the page is open; another
traveler's booking and an unknown type are Not found; an admin is denied; an unverified email is
sent to verification; a higher-fare change is paid and returns to the change page; an equal fare
never reaches payment; no sideways scrolling at 360, 768, 1024 and 1440 pixels.

### By hand, with real Stripe test mode

1. Put the test keys in `backend/.env` (secret key) and `frontend/.env.local` (publishable key).
2. Forward webhooks to the local backend and copy the printed `whsec_...` into
   `STRIPE_WEBHOOK_SECRET`:

   ```bash
   stripe listen --forward-to localhost:3000/api/payments/webhook
   ```

3. Hold a flight, open its payment link, accept the policies and pay with:
   - `4242 4242 4242 4242`, any future date, any CVC: success. The result page turns to Payment
     confirmed when the webhook arrives; stop `stripe listen` to see the "still processing" state.
   - `4000 0000 0000 0002`: declined. The reason shows; Try again starts a retry.
   - `4000 0025 0000 3155`: 3-D Secure. Stripe redirects back to `/checkout/result`.

Hotel checkout is tried by holding a hotel booking through the API (`POST /api/hotel-bookings`
in Swagger) and opening `/checkout/hotel/{hotelBookingId}`: Osama's booking pages are not on
`develop` yet. The backend's hotel payment hooks are connected; it answers 503 only if they are not.

## Known limits

- The backend has no "read my acceptance" endpoint, so after a reload the traveler ticks the box
  again. Accepting again only refreshes the stored timestamp.
- Hotel checkout has no browser test: the disposable backend has no hotel fixtures and Osama's pages
  are pending. It uses the same code path as flights.
- `PaymentRefundStatus` is not yet mounted on Ismail's or Osama's pages; they swap it in.
- The policies name an airline only by id, so checkout labels it by its flight numbers
  ("Airline of MS1234").
- The fake Stripe.js proves our wiring, not Stripe's own form; real Stripe is checked by hand as above.
