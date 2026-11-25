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
   `/checkout/result`, which reads the payment (`GET /api/payments/:id`) **and** the booking or change
   (`GET /api/flight-bookings/:id`, `/api/hotel-bookings/:id`, `/api/flight-booking-changes/:id`)
   every 2 seconds for about a minute. The backend changes the payment only from the signed webhook,
   or by asking Stripe itself while it is PENDING. The decision is in `features/payments/outcome.ts`:
   - booking CONFIRMED or COMPLETED: "Payment confirmed" and the continue link. This is the only success;
   - payment PENDING, or SUCCEEDED while the booking is still PENDING inside its hold: "Confirming";
     after a minute "still processing" with Check again (a late webhook);
   - payment FAILED with a normal reason: the `failureReason`, "Nothing was charged" and Try again;
   - payment FAILED with "Paid amount does not match the booking amount": an administrator checks
     it, no Try again;
   - the hold ended or the booking was cancelled (whatever the payment says): "Your hold ended before
     the payment completed. If you were charged, the full amount is refunded", with
     `PaymentRefundStatus` for the payment and the booking's refund.

   Stripe's redirect query (`payment_intent`, `redirect_status`) is ignored. A 401 stops the watch
   and offers sign-in back to the same page; a 404 stops it with "Payment not found".

**Late success after expiry.** If Stripe's success arrives after the hold ended, the backend marks the
Payment SUCCEEDED but does not confirm the booking and refunds the full amount automatically. The
result page therefore never reads success from the payment alone.

**Retrying.** After a declined card, Try again first reads `GET /api/payments/:id`, so the backend
records the decline. A FAILED payment then goes straight to `POST /api/payments/:id/retry` (a new
PaymentIntent on the same Payment); a still PENDING one is reopened with `POST /api/payments`. A
fresh page (a reload, or the result page's Try again) does not know the earlier payment: there
`POST /api/payments` answers 409 "The last payment failed. Use POST /api/payments/<id>/retry", and
checkout takes the id from that message with a small commented regex (it is our own message).

**Conflicts.** Any other 409 from accepting or paying (already paid, hold expired, policies changed,
payment in progress) is shown in plain words and checkout refreshes itself from the server, which
then shows "already paid" or "hold expired". A Reload checkout link stays as a fallback. If the
policies accepted on the server differ from the ones on screen (the provider changed them while the
traveler was reading), checkout does not mark them accepted and asks the traveler to read the
current ones and accept again.

**Back button.** Coming back to checkout after submitting a card: before Pay is enabled, the form
asks Stripe (`stripe.retrievePaymentIntent`) about the open PaymentIntent. If it is processing,
succeeded or requires capture, checkout goes to the result page instead of offering to pay again;
`payment_intent_unexpected_state` from `confirmPayment` is treated the same. After a confirmed
payment, Back shows "This booking is already paid" (directly, or after the 409 refresh above).

**Hold expiry.** `HoldTimer` gets `serverNow` from the server render. When it reaches zero, checkout
disables payment and refreshes the page; only the server decides whether the hold ended. An ended hold
shows "Your hold has expired" with a link back to the booking. The countdown never claims anything by
itself.

**Double submission.** Accept and Pay are disabled while they run. A successful card submission stays
locked while the result page opens. After any error the traveler can act again.

**Accessibility.** After accepting, focus moves to the "Policies accepted" confirmation. The result
page has one polite live region that announces each change of outcome once. Every status is written
out, not only coloured.

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

The config **rebuilds `.next`** with a placeholder publishable key, so run `npm run build` again
before `npm start` or another suite that uses `next start`. It starts `scripts/payments-backend.cjs`:
the real Nest app on a throwaway MongoDB replica set (ports 3120 and 3121), with the backend's
FakeStripe and signed, verified webhooks. js.stripe.com is not reachable in CI, so the spec serves a
tiny fake Stripe.js through `page.route`. Set `PLAYWRIGHT_CHROMIUM_PATH` to use a preinstalled
Chromium, or `PLAYWRIGHT_CHANNEL=chrome` for installed Chrome. The harness is a copy of Ismail's
`flight-bookings-backend.cjs` with more controls (a bookable hotel, read a booking's payment, a
signed failure webhook, a success with another amount, unverify an email); his file is unchanged.

Covered: guest sign-in and return; Pay disabled until the policies are accepted, with the accepted
time shown; a double-clicked Pay confirms once; success only after the signed webhook, then the ticket
link; a declined card, then a retry with a new PaymentIntent; a failed payment on the result page and
its retry through checkout; an expired hold, also one that ends while the page is open; another
traveler's booking and an unknown type are Not found; an admin is denied; an unverified email is
sent to verification; a higher-fare change is paid and returns to the change page; an equal fare
never reaches payment; no sideways scrolling at 360, 768, 1024 and 1440 pixels. Also: a hotel
journey (check-in/out times and check-in tiers, webhook, link to `/bookings/hotels/{id}`); a success
after the hold ended shows the refund, not "confirmed"; an amount mismatch goes to an admin with no
retry; Back after submitting goes to the result page instead of paying again, and Back after paying
ends on "already paid"; a reload asks for acceptance again and reuses the open payment; a forged
`redirect_status` or mismatched type is not trusted; an ended session stops the watch with a sign-in
link; a minute-long wait ends in "still processing" and Check again.

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
- Osama's hotel booking pages are pending, so the hotel return link is Not found until they merge.
- "Payment SUCCEEDED but the booking still PENDING inside its hold" has no browser test: the signed
  webhook confirms the booking in the same request, so the state is too short to hold in a test.
- `PaymentRefundStatus` is not yet mounted on Ismail's or Osama's pages; they swap it in.
- The policies name an airline only by id, so checkout labels it by its flight numbers
  ("Airline of MS1234").
- The fake Stripe.js proves our wiring, not Stripe's own form; real Stripe is checked by hand as above.
