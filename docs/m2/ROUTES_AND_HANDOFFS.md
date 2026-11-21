# M2 routes and integration handoffs

Prepared 2026-11-22 against `origin/develop` commit
`7665c5849a186823b227be99de3b51bb412ad17b` and the unified eight-person M2 PDF.
The official workbook and revised project description control acceptance criteria;
the current backend DTOs and `/api/docs-json` control requests and responses.

This is the initial registry for the foundation PR. Named builder/consumer acceptance
is **pending**; a written contract is not evidence that teammates have agreed to it.
Only the minimal foundation/authentication slice is implemented by this PR. Routes
listed below reserve ownership and do not claim those pages already exist.

## Route ownership

| Owner | Reserved Next.js routes | Feature folders |
| --- | --- | --- |
| Malak | `/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/account/profile`, `/account/security`; global role routing and shared layouts | `auth`; shared `components/ui`, `components/layout`, `lib/api`, `lib/format`, `config`, `types` |
| Arwa | `/admin`, `/admin/accounts`, `/admin/moderators`, `/admin/providers`, `/admin/bookings`, `/admin/reports`, `/admin/audit-logs`, `/admin/analytics`, `/notifications` | `admin`, `notifications`, `reports` |
| Gamila | `/flights`, `/flights/[id]`, `/moderator/airline`, `/moderator/airline/flights`, `/moderator/airline/flights/new`, `/moderator/airline/flights/[id]`, `/moderator/airline/policies`, `/moderator/airline/passengers` | `flights`, `airline-moderator` |
| Ismail | `/bookings` (hub), `/bookings/flights/new`, `/bookings/flights`, `/bookings/flights/[id]`, `/bookings/flights/[id]/ticket`, `/bookings/flights/[id]/change` (bonus) | `flight-bookings` |
| Lama | `/hotels`, `/hotels/[id]`, `/moderator/hotel`, `/moderator/hotel/rooms`, `/moderator/hotel/rooms/new`, `/moderator/hotel/availability`, `/moderator/hotel/policies`, `/moderator/hotel/reservations` | `hotels`, `hotel-moderator` |
| Osama | `/bookings/hotels/new`, `/bookings/hotels`, `/bookings/hotels/[id]`, `/favorites`; embedded review/reply widgets | `hotel-bookings`, `reviews`, `favorites` |
| Kiki | `/itineraries`, `/itineraries/new`, `/itineraries/[id]`, `/itineraries/[id]/edit`, `/explore/itineraries`, `/explore/itineraries/[id]` | `itineraries` |
| Hicham | `/checkout/[type]/[bookingId]`, `/checkout/result`, `/blog`, `/blog/[id]`, `/blog/new`, `/blog/mine`, `/blog/[id]/edit`, `/authors/[id]` | `payments`, `blog` |

The development-only component gallery belongs to Malak at `/dev/ui`. Do not add
domain pages or duplicate fetching logic to make navigation appear complete.
The foundation's role landing destinations are shared integration shells:
`/workspace/traveler` (USER), `/workspace/admin` (ADMIN),
`/workspace/airline` (AIRLINE_MODERATOR), and `/workspace/hotel`
(HOTEL_MODERATOR). A mismatched role shows Access denied. These shells belong to
Malak and do not implement the named owners' dashboards. Moving role landings to
their final domain pages remains an integration change with the relevant owner.
Backend guards remain the authority.

## API boundaries verified in source

- Authentication returns `{ userId, name, email, role, status, createdAt, updatedAt }`,
  not a universal `_id`. Roles are `USER`, `ADMIN`, `AIRLINE_MODERATOR`,
  `HOTEL_MODERATOR`; statuses are `ACTIVE`, `SUSPENDED`, `DEACTIVATED`.
- Login can instead return **only** `{ passwordChangeRequired: true }`. That is a
  restricted session, not a normal signed-in identity. `GET /api/auth/me` rejects
  it. Submit `PATCH /api/auth/change-password` with `currentPassword` and
  `newPassword`, then require a fresh login; changing the password clears cookies.
  The foundation directs that response to `/account/security?required=1`. This
  page permits submitting the change without a normal identity; its URL hint
  preserves the prompt after refresh but never grants authorization.
- Errors use `{ statusCode, error, message, errors? }`, where `errors` is
  `Record<string, string[]>`. Nested validation paths include array indices.
  Preserve field errors, use safe general fallbacks for failed/network responses,
  and never display raw HTML or exception stacks.
- Lists normally return `{ items, page, pageSize, total, totalPages }`, with
  1-based pages and page size 10. Flight/hotel booking lists and review lists omit
  `totalPages`; derive it as `Math.ceil(total / pageSize)`. Reviews additionally
  return `averageRating` and `ratingCount`; notifications add `unreadCount`.
  Do not assume every endpoint returns this envelope: read its OpenAPI response.
- IDs are endpoint-specific. Flight booking details use `flightBookingId` and
  `totalAmount`; hotel booking details use `hotelBookingId` and `totalPrice`.
  Payment/refund responses use `_id`. Adapt these once at feature boundaries.
- Backend security uses Secure, HttpOnly, SameSite=Lax `__Host-` cookies with
  `Path=/` and no Domain, same-origin browser writes, and no open CORS policy.
  Keep all browser calls under the frontend's `/api` proxy. Never store tokens in
  localStorage/sessionStorage or return them from a frontend wrapper.

### Money: correct the PDF shorthand at the API boundary

The PDF describes all booking/payment/refund figures as cents. The final backend
explicitly uses **two units**. Do not change backend values to fit the PDF.

| Returned boundary | Unit and example | Formatter |
| --- | --- | --- |
| Flight cabins/fares/baggage and booking/cancellation amounts; hotel room/night, stay/booking/cancellation amounts | USD integer minor units: `15050` = $150.50 | `formatMoneyMinorUnits` |
| Flight booking detail's embedded `refund.amount`; hotel booking `refundAmount` | Booking-facing integer minor units (the payment adapter converts) | `formatMoneyMinorUnits` |
| Payment and Refund documents; `GET /api/bookings/:type/:id/policies` top-level `amount` | USD major units: `150.5` = $150.50 | Major-unit currency formatting, no division by 100 |
| Itinerary activity costs, budget/transport amounts and budget summaries; linked-booking summary `amount` | Major units in the returned currency, including backend-converted booking amounts | Major-unit currency formatting, no division by 100 |

Use DTO/source definitions for nested policy figures; the policy response's
top-level `amount` does not establish the unit of every nested field. Never send a
client-computed payment amount. Payments obtain the amount from the booking.
Itinerary currencies come from the official backend catalog (`AED`, `EGP`, `EUR`,
`GBP`, `JPY`, `SAR`, `USD`), and FX runs only in the backend.

Flights expose UTC instants plus airport IANA time zones; format each airport with
its own `Intl.DateTimeFormat` timeZone. Hotel check-in/out values remain
`YYYY-MM-DD`, with checkout exclusive; do not run date-only values through local
timezone conversion.

Source anchors: [auth identity](../../backend/src/auth/dto/registered-user.dto.ts),
[errors](../../backend/src/common/dto/api-error.dto.ts),
[flight booking DTOs](../../backend/src/flight-bookings/dto/flight-booking-response.dto.ts),
[hotel booking DTOs](../../backend/src/hotel-bookings/dto/hotel-booking-response.dto.ts),
[payment/refund units](../../backend/src/payments/dto/payment-response.dto.ts),
[policy amounts](../../backend/src/payments/policies.service.ts),
[itinerary amounts](../../backend/src/itineraries/dto/budget-entry.dto.ts).

## Proposed component inputs: builders retain implementation ownership

These are initial TypeScript-facing inputs, **not new API DTOs**. Producers export
their types from their own feature folder; Malak approves shared changes with
each listed consumer before implementation. No empty implementations are added
for another person's component.

| Producer and consumer | Proposed interface | Acceptance still needed |
| --- | --- | --- |
| Malak header; Arwa notification bell | `AppHeader({ user, notificationSlot?: ReactNode })` | Arwa owns count/list/read state and mounts one bell in the slot |
| Gamila FlightSearch; Malak, Ismail, Kiki | `FlightSearch({ initialQuery?, onSelect? })`; selection `{ segments: [{ flightId, cabinId }], adults, children, infants }` | Gamila exports actual query type; Ismail validates one/two segments against hold DTO; Kiki confirms airport/date prefills |
| Lama HotelSearch; Malak, Osama, Kiki | `HotelSearch({ initialQuery?, onSelect? })`; selection `{ hotelId, roomIds, checkIn, checkOut, adults, childrenAges }` | Lama exports query type; Osama turns selection into per-room allocations; Kiki sets checkout to day after the group ends |
| Ismail/Osama holds; Hicham checkout | `Checkout({ type: 'flight' | 'hotel', bookingId })` | Pass `flightBookingId`/`hotelBookingId` into `bookingId`; checkout re-fetches owned snapshot and hold expiry |
| Hicham status UI; Ismail, Osama | `BookingStatusPanel({ type, bookingId })` | Backend status only; redirect/query strings never confirm payment |
| Osama reviews; Lama | `ReviewList({ hotelId })`, `ReviewEditor({ hotelBookingId, onSaved? })`, moderator reply widget `{ reviewId, onSaved? }` | Eligibility/ownership enforced by backend; consistent aggregate refresh |
| Osama favorites; Lama, Kiki | `FavoriteButton({ target: { type: 'hotel' | 'itinerary', id }, onChanged? })` | Adapt target to real favorites API; unavailable targets reveal no hidden content |
| Arwa reports; Osama, Kiki, Hicham | `ReportAction({ targetType: 'POST' | 'COMMENT' | 'REVIEW' | 'ITINERARY', targetId, onReported? })` | API field names are `targetType`/`targetId`, not PDF `contentType`/`contentId`; reason 5-500 characters |
| Kiki itinerary picker; Hicham | `ItineraryPicker({ value?: string, onChange })` | Kiki supplies eligible owned/public entries; Hicham submits actual attachment field |
| Gamila/Lama provider lists; Arwa | `{ providerType: 'airline' | 'hotel', providerId }` | Provider deactivation and moderator suspension remain distinct operations |

`initialQuery` must preserve backend query names and URL filter state, not a second
search implementation. Holds are created only by Ismail/Osama. Hicham accepts
policies before payment and waits for webhook-backed status. `flight-change` is
already a backend booking type; Ismail/Hicham must agree its bonus route/props
extension before adding it to the baseline checkout interface.

## Open integration decisions

| Decision or gap | Responsible parties | State |
| --- | --- | --- |
| Each row's exact exported props/query type and imports | Named producer + consumers, Malak | Pending teammate acceptance |
| Notification deep-links | Arwa + affected feature owners | Backend `NotificationDto` has no target ID/href; do not invent links from message text |
| Landing flight/hotel/trip/blog widgets | Gamila, Lama, Kiki, Hicham + Malak | Pending producer exports; foundation must not duplicate their requests |
| Role destination domain pages | Arwa, Gamila, Lama | Reserved; domain implementation stays with owner |
| Shared contract changes | Malak + all consumers | Written PR note required before consumers migrate |
