# M2 routes and integration handoffs

Updated 2026-11-22 for the **optimized 26-page M2 team handoff**, which supersedes
the original 37-page split. The foundation was prepared against `develop`
`7665c5849a186823b227be99de3b51bb412ad17b` and merged through PR #125 as `5de75e5`.
The official workbook and revised project description control acceptance criteria;
the current backend DTOs and `/api/docs-json` control requests and responses.

This is the corrected registry for the merged foundation. Named builder/consumer acceptance
is **pending**; a written contract is not evidence that teammates have agreed to it.
Malak's account routes and base shared UI are available. The registry reserves
the other owner routes for their respective implementations.

## Route ownership

| Owner | Reserved Next.js routes | Feature folders |
| --- | --- | --- |
| Malak | `/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/account/profile`, `/account/security`; global role routing and shared layouts | `auth`; root configuration, base `components/ui`, `components/layout`, `lib/api` and genuinely common contracts |
| Arwa | `/admin`, `/admin/accounts`, `/admin/moderators`, `/admin/providers`, `/admin/bookings`, `/admin/reports`, `/admin/content`, `/admin/audit-logs`, `/admin/analytics`, `/notifications` | `admin`, `notifications`, `reports`; shared table/pagination/filter presentation |
| Gamila | `/flights`, `/flights/[id]`, `/moderator/airline`, `/moderator/airline/flights`, `/moderator/airline/flights/new`, `/moderator/airline/flights/[id]`, `/moderator/airline/policies`, `/moderator/airline/passengers`; airline-create form hosted in Arwa's admin route; embedded SeatSelector consumed by Ismail | `flights`, `airline-moderator`; flight search/time/seat UI |
| Ismail | `/bookings` (hub), `/bookings/flights/new`, `/bookings/flights`, `/bookings/flights/[id]`, `/bookings/flights/[id]/ticket`, `/bookings/flights/[id]/change` (bonus) | `flight-bookings` |
| Lama | `/hotels`, `/hotels/[id]`, `/moderator/hotel`, `/moderator/hotel/rooms`, `/moderator/hotel/rooms/new`, `/moderator/hotel/availability`, `/moderator/hotel/policies`, `/moderator/hotel/reservations`; moderator review-reply UI and hotel-create form hosted in Arwa's admin route | `hotels`, `hotel-moderator`; shared media/gallery and hotel date-only controls |
| Osama | `/bookings/hotels/new`, `/bookings/hotels`, `/bookings/hotels/[id]`, `/favorites`; shared review/rating and favourite widgets | `hotel-bookings`, `reviews`, `favorites` |
| Kiki | `/itineraries`, `/itineraries/new`, `/itineraries/[id]`, `/itineraries/[id]/edit`, `/explore/itineraries`, `/explore/itineraries/[id]` | `itineraries` |
| Hicham | `/checkout/[type]/[bookingId]` for `flight`, `hotel` and `flight-change`, `/checkout/result`, `/blog`, `/blog/[id]`, `/blog/new`, `/blog/mine`, `/blog/[id]/edit`, `/authors/[id]` | `payments`, `blog`; payment/refund status and endpoint-specific money adapters |

The development-only component gallery belongs to Malak at `/dev/ui`. Do not add
domain pages or duplicate fetching logic to make navigation appear complete.
The foundation's role landing destinations are shared integration shells:
`/workspace/traveler` (USER), `/workspace/admin` (ADMIN),
`/workspace/airline` (AIRLINE_MODERATOR), and `/workspace/hotel`
(HOTEL_MODERATOR). A mismatched role shows Access denied. These shells belong to
Malak and do not implement the named owners' dashboards. Moving role landings to
their final domain pages remains an integration change with the relevant owner.
Backend guards remain the authority.

`/admin/providers` has one page owner: Arwa. Gamila supplies the airline-create
form/API adapter and Lama supplies the hotel-create form/API adapter; Arwa hosts
them and owns admin route state and permissions. `/admin/content` covers direct
moderation of supported content, including items without a report. Gamila leads
the FLT-28 seat-selection frontend; Ismail retains the booking API and mounting
context. Lama leads HTL-26 moderator replies; Osama retains review backend/data
ownership. BON-02 favourites remain with Osama. Other M1 backend owners do not move.

## Shared construction: one builder per reusable module

This table follows the optimized handoff. It assigns future construction; it does
not claim every listed component has already been implemented. Domain types live
beside their features; genuinely common types remain shared.

| Builder | Maintained shared construction | Required consumers / boundary |
| --- | --- | --- |
| Malak | Root package/config/lockfile, global tokens/layout, API/error/session base; Button/Input/Select/FormField/Card/Badge/ConfirmDialog and shared loading/empty/error states | All owners compose these primitives. The home uses `HomeContent` slots for P3/P5/P7/P8 exports |
| Arwa | DataTable/Pagination and table-filter presentation; ReportAction; NotificationBell/inbox and direct-moderation UI | All list owners supply columns and actual server pages; P6/P7/P8 mount reporting; P1 hosts bell. Arwa owns admin routes/provider-entry integration |
| Gamila | FlightSearch/FlightCard, airport/time utilities, SeatSelector; airline-create form/API adapter | Malak/Kiki reuse search/cards; Ismail supplies booking/segment context and mounts seats; Arwa hosts provider form |
| Ismail | BookingStepper, server-expiry HoldTimer, traveler `/bookings` hub and shared lifecycle checklist | Osama/Hicham reuse presentation with their actual APIs; Osama supplies hotel hub links/summary; Gamila supplies seat UI. Osama/Hicham co-verify lifecycle |
| Lama | Image uploader/gallery, hotel date-only controls, HotelSearch/HotelCard; hotel-create form/API adapter; moderator review-reply UI | Gamila/Kiki/Hicham consume media controls with their own endpoints/permissions; Osama/Kiki consume stay/search inputs; Arwa hosts provider form; Osama supplies review data |
| Osama | ReviewList/rating widgets and eligible review editor; favourite state/button/list | Lama consumes reviews/ratings and supplies moderator reply UI; Lama/Kiki mount favourites and invalidate visibility changes |
| Kiki | ItineraryPicker/Preview with ownership, privacy and invalidation behavior | Hicham consumes for BLG-13; Malak consumes public previews. No additional general infrastructure library is assigned |
| Hicham | PaymentRefundStatus, shared flight/hotel/flight-change checkout and endpoint-specific money format/normalization adapters plus field-to-unit map | Ismail/Osama consume payment/refund display; P2/P3/P4/P5/P6/P7 consume verified money semantics; Arwa reconciles analytics |

Existing low-level `formatMoneyMinorUnits`/`formatMoneyMajorUnits` functions remain
available. Hicham owns the endpoint-aware adapters and amount-unit map built on
them; their presence does not transfer that semantic responsibility to Malak.
Avoid concurrent root lockfile/layout/global-CSS edits. Each shared change names
its builder and consumer verifier, and each owner supplies their own documentation
and component-gallery examples.

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

### Money: endpoint-specific units in the optimized handoff

The **original 37-page PDF's** blanket cents shorthand is superseded. The optimized
26-page PDF accurately distinguishes the final backend's **two units** below.
Hicham maintains the explicit field-to-unit map and endpoint adapters; each
consumer verifies its exact DTO fields, particularly cancellation/change/analytics
values. Do not convert a value twice or change backend values to fit old shorthand.

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
| Malak header; Arwa notification bell | Implemented `AppHeader({ accountSlot?: ReactNode, notificationSlot?: ReactNode })` | Account UI consumes shared session state; Arwa owns count/list/read state and mounts one bell in the slot. There is no `user` prop |
| Malak email eligibility; Ismail, Osama and Hicham | `BookingEmailGate({ children, returnTo })`, `isEmailVerificationRequiredError(error)` and `verificationPath(returnTo)` from `@/features/auth/email-verification` | Mount around hold/payment actions and link back from an eligibility rejection. Each owner proves the live gate in their flow |
| Arwa DataTable/Pagination; list owners | Column definitions, actual `{ items, page, pageSize, total }` or endpoint-specific envelope, URL/filter state and page-change callback | Arwa exports exact prop types with consumers; keep server page size 10 and do not slice one API page to fake pagination |
| Gamila FlightSearch; Malak | `<FlightSearch variant="home" />` from `@/features/flights/flight-search` | Gamila confirmed the home interface. Mount it in `HomeContent` once her export reaches `develop` |
| Gamila flight search and results; Ismail, Kiki | `initialCriteria` prefills search. Flight and cabin selection uses `{ segments: [{ flightId, cabinId }], adults, children, infants }` | Confirm the exported types with Gamila. Ismail validates one/two segments against the hold DTO and Kiki checks airport/date prefills |
| Lama HotelSearch; Malak, Osama, Kiki | `HotelSearch({ initialQuery?, onSelect? })`; selection `{ hotelId, roomIds, checkIn, checkOut, adults, childrenAges }` | Lama exports query type; Osama turns selection into per-room allocations; Kiki sets checkout to day after the group ends |
| Gamila SeatSelector; Ismail | Verified booking/segment/cabin context, eligible passengers and selection-change/refresh callbacks | Gamila builds FLT-28 UI; Ismail supplies actual booking/seat mutation contracts and mounting. Exact props and conflict/retry behavior remain joint acceptance items |
| Ismail steps/timer; Osama, Hicham | `BookingStepper` step model; `HoldTimer` server expiry and expiry callback | Presentation only: countdown does not release stock or confirm payment; consumers retain separate domain API contracts |
| Ismail/Osama held records; Hicham checkout | `Checkout({ type: 'flight' \| 'hotel' \| 'flight-change', bookingId })`, plus server expiry/status refresh contract | Ordinary IDs are `flightBookingId`/`hotelBookingId`; for `flight-change`, `bookingId` is the change-record ID. Checkout re-fetches owned policies/amount/status and creates no duplicate hold |
| Hicham status UI; Ismail, Osama | `PaymentRefundStatus({ type, bookingId })` with the three verified payment types | Exact exported props pending; backend status only, and redirects/query strings never confirm payment |
| Hicham money adapters; P2/P3/P4/P5/P6/P7 | Endpoint/field-specific wire amount, declared unit/currency and display value | Hicham supplies an explicit field-to-unit map and types; preserve wire values and server-calculated amounts, with no repeated conversion |
| Lama media/date controls; Gamila, Osama, Kiki, Hicham | Upload/gallery inputs include caller-supplied endpoint/action, value, maximum count, progress/error/remove callbacks; date-only controls preserve `YYYY-MM-DD` | Exact props pending; JPG/PNG <=5 MB, max five hotel/post/activity images or one airline logo. Domain endpoint authorization remains with consumer/backend |
| Osama reviews; Lama | `ReviewList({ hotelId })`, `ReviewEditor({ hotelBookingId, onSaved? })`, rating data/refresh contract | Osama owns review/data widgets and backend; Lama builds moderator reply action against that contract. Eligibility, assigned-hotel authorization and aggregate refresh are verified together |
| Lama moderator replies; Osama | Reply UI receives actual review identity and success/invalidation callback | Lama leads HTL-26 frontend; Osama supplies actual reply/read API limits and the shared list reflects successful replies. No invented edit/delete capability |
| Osama favorites; Lama, Kiki | `FavoriteButton({ target: { type: 'hotel' \| 'itinerary', id }, onChanged? })` | Adapt target to real favorites API; unavailable targets reveal no hidden content |
| Arwa reports; Osama, Kiki, Hicham | `ReportAction({ targetType: 'POST' \| 'COMMENT' \| 'REVIEW' \| 'ITINERARY', targetId, onReported? })` | API field names are `targetType`/`targetId`, not PDF `contentType`/`contentId`; reason 5-500 characters |
| Kiki itinerary picker/preview; Hicham | `ItineraryPicker({ value?: string, onChange })` and visibility-safe preview data | Kiki supplies eligible owned/public entries and invalidation on privacy/removal; Hicham submits actual attachment field |
| Gamila/Lama provider-create forms and adapters; Arwa | Caller role/provider context and completion/error/invalidation callbacks, with actual create DTOs owned by each domain | Arwa owns `/admin/providers` and host behavior; do not create a second domain form or shared admin route. Provider deactivation and moderator suspension remain distinct operations |

Search prefills preserve backend query names and URL filter state. Ismail and
Osama create holds. Hicham accepts
policies before payment and waits for webhook-backed status. `flight-change` is
already a backend payment type and is included in the optimized baseline checkout
contract; Ismail/Hicham still need to agree its exact exported props, record-ID
handoff, expiry and equal/lower/higher-fare recovery behavior before integration.

### Flight search on the home page

Gamila confirmed that home search starts with blank airports and dates, one-way
selected, one adult and no cabin selection. Submitting navigates to `/flights`
with `departureAirportCode`, `arrivalAirportCode`, `departureDate`, `roundTrip`,
`adults`, `children`, `infants`, optional `cabinClass`, and `returnDate` for
round trips. The results page reads the URL, restores the form with
`initialCriteria`, and makes the search request. Gamila also confirmed that
`FlightCard` will be available from the same folder for itinerary reuse.
[Gamila's reply in issue #127](https://github.com/MalakMostafa-16003651/travel-planning-booking-platform/issues/127#issuecomment-7085410702)

On 24 November, `develop` contains `GET /api/flights/mine` and flight pagination
with `totalPages`. The planned frontend export and `/moderator/airline` page
are pending. Gamila is targeting 27 November for the dashboard. The current
airline sign-in lands at `/workspace/airline`. Switch that destination once the
owner page is available on `develop` and its access check passes.

When both surfaces are available, verify one-way and round-trip submissions
from home, URL restoration after reload, and direct dashboard access with an
airline moderator and with the wrong role.

## Open integration decisions

| Decision or gap | Responsible parties | State |
| --- | --- | --- |
| Each row's exact exported props/query type and imports | Named producer + consumers, Malak | Pending teammate acceptance |
| Seat selection and moderator replies | Gamila-Ismail; Lama-Osama | Corrected frontend leads are Gamila for FLT-28 and Lama for HTL-26; backend owners stay unchanged |
| Provider creation and direct moderation | Arwa with Gamila/Lama and content owners | `/admin/providers` and `/admin/content` belong to Arwa; domain forms/adapters and permitted content navigation are supplied by their owners |
| Notification deep-links | Arwa + affected feature owners | Backend `NotificationDto` has no target ID/href; do not invent links from message text |
| Landing flight/hotel/trip/blog widgets | Gamila, Lama, Kiki, Hicham + Malak | Gamila confirmed the flight interface above. Check for its implementation and the remaining producer exports in [issue #127](https://github.com/MalakMostafa-16003651/travel-planning-booking-platform/issues/127) |
| Role destination domain pages | Arwa, Gamila, Lama | Owners confirm their dashboards are ready before their routes are promoted to login destinations. Tracked in issue #127 |
| Shared contract changes | Malak + all consumers | Written PR note required before consumers migrate |
