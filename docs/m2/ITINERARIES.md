# Itineraries frontend (Kiki, Person 7 — 16001313)

Requirements: ITN-01, ITN-03, ITN-05, ITN-07, ITN-08, ITN-09, ITN-10, ITN-12, ITN-14, ITN-16, ITN-18, ITN-20,
ITN-21, ITN-25, ITN-26, bonuses ITN-27 and ITN-28; the itinerary side of ACC-10, ACC-11, GEN-02 to GEN-05,
GEN-08 to GEN-10 and GEN-16. Feature folder: `frontend/src/features/itineraries`. Backend contracts:
`backend/src/itineraries` and `backend/src/itinerary-exports` (controllers, DTOs, `ItinerariesService`).
Merged in #148; shared ReportAction/Pagination adoption in #170.

## Setup

No extra setup beyond the [frontend README](../../frontend/README.md): the real Nest API on `localhost:3000`, the
frontend on `localhost:3001`, the official reference data seeded (`seed:references`, `seed:currencies`,
`seed:airports`). ITN-18 conversion needs `FXRATES_API_KEY` in the backend `.env`; without it, totals in another
currency show the clear "rates unavailable" state unless rates were cached earlier. No frontend environment values
or packages were added.

## Routes and rendering

| Route | Purpose | Rendering and why |
| --- | --- | --- |
| `/itineraries?page=` | Own itineraries, most recently updated first, pages of 10 (ITN-03) | Dynamic SSR with the viewer's cookies, `no-store`: private to the signed-in traveler. Guests go to sign in and come back |
| `/itineraries/new` | Create: title, catalog countries, start date, private by default (ITN-01) | Static shell + client form behind `RequireSession role="USER"`; the backend enforces the role again |
| `/itineraries/[id]` | Read view: days by city stop, activities, photos, budget entries, transport, budget panel, PDF. Owner sees Edit; others see Clone/Report on public trips; admins preview public trips, hidden ones included | Dynamic SSR with the viewer's cookies, `no-store`: the same URL serves a private trip to its owner and a public one to anyone, so it can never be shared-cached |
| `/itineraries/[id]/edit` | Owner editor: details, visibility, days (add/insert/edit/delete/reorder), activities, photos, budget entries, transport, linked bookings, budget side panel | Dynamic SSR shell with the owner's itinerary, then a Client Component. Every mutation returns the full recomputed itinerary, which replaces client state: day numbers, dates, city groups and totals are always the server's |
| `/itineraries/[id]/hotels?dayId=&guests=&rooms=&page=` | ITN-25 hotels for one city stop | Dynamic SSR shell + client search; criteria in the URL for refresh/back |
| `/itineraries/[id]/flights?departureAirportCode=&roundTrip=&…` | ITN-26 flights to the first day's city | Dynamic SSR shell + client search; criteria in the URL |
| `/explore/itineraries?q=&country=&city=&minDays=&maxDays=&sort=&page=` | ITN-21 public search | Dynamic SSR from the anonymous public endpoint, `no-store`; a plain GET form, so it works before JavaScript loads |
| `/explore/itineraries/[id]` | ITN-21 public read view with author, Clone and Report | Dynamic SSR from the anonymous public endpoint, `no-store` |
| `/dev/ui/itineraries` | Picker/preview examples | Development only |

**Why no ISR for public itineraries.** Description section 9 suggests static/ISR for suitable public pages, and it
was considered here. It was rejected because an itinerary can stop being public through actions this domain cannot
observe or invalidate: an administrator hiding it (GEN-10) or its author deactivating (ACC-12). A cached copy could
keep exposing content that ITN-20 says must disappear immediately. Public reads therefore send no cookies (so they
can never contain owner-only data such as linked bookings) and are never cached. Only the country, city and
currency catalogs are cached, for 5 minutes. Hicham's blog makes the same choice for the same reasons.

## Data and contracts

| Data | Source | Notes |
| --- | --- | --- |
| Itinerary, days, city groups, activities, budget entries, transport | `GET/POST/PATCH/DELETE /api/itineraries/**`, `/api/activities/:id`, `/api/budgets/:id`, `/api/transport-costs/:id` | Field names as in `itinerary-response.dto.ts`. Optional text is cleared with `""`; an activity cost with `cost: null`; an activity time with `null` (the DTO rejects `""` for times) |
| Activity photos (ITN-12, GEN-08) | `POST /api/activities/:id/images` (field `image`), `DELETE …/images/:imageId` | Lama's `MediaUploader`; JPG/PNG ≤ 5 MB, 5 per activity; image URLs follow the itinerary's visibility |
| Budget summary (ITN-14, ITN-18) | `GET /api/itineraries/:id/budget-summary?currency=` | Re-read after every saved change; FX only in the backend with daily cached rates; shows `rateDate`, the `ratesStale` notice, 503 "no rates" and 422 "no rate for a currency" |
| Public search and clone (ITN-21) | `GET /api/itineraries/public/search`, `GET /api/itineraries/public/:id`, `POST /api/itineraries/:id/clone` | Clone is USER only, creates a private copy crediting the author |
| Hotels / flights from a trip (ITN-25, ITN-26) | `GET /api/itineraries/:id/hotels`, `GET /api/itineraries/:id/flights` | The backend derives city and dates; results use Lama's `HotelCard` and Gamila's `FlightCard`; flight selections go to Ismail's `/bookings/flights/new` as `FlightSelection` |
| Linked bookings (ITN-27) | `POST /api/itineraries/:id/bookings`, `DELETE …/bookings/:linkedBookingId`; candidates from `GET /api/flight-bookings` and `GET /api/hotel-bookings` | Only own CONFIRMED/COMPLETED bookings on covered days (hotel nights; flight local departure date). Owner-only: never in public views or clones |
| PDF (ITN-28) | `GET /api/itineraries/:itineraryId/pdf` | Signed-in users, same visibility as viewing; streamed through the proxy with progress |
| Reports (GEN-09) | Arwa's `ReportAction` → `POST /api/reports` | Public trips, non-owners, once per person |

**Money units (PAY-04).** Itinerary activity costs, budget entries, transport costs, budget summaries and the
itinerary API's linked-booking `amount` are major units in their own currency (`formatMoneyMajorUnits`). Booking
list prices shown in the ITN-27 picker are cents (`formatMoneyMinorUnits`). Booking prices are never converted to
the itinerary display currency except inside the backend's budget summary.

**Dates.** Day dates are backend `YYYY-MM-DD` values, formatted in UTC so they never shift a day. Flight times use
each airport's IANA zone through Gamila's card (GEN-06).

## Shared components I supply

```tsx
import { ItineraryPicker } from '@/features/itineraries/itinerary-picker';
import { ItineraryPreview } from '@/features/itineraries/itinerary-preview';
import { PublicItinerariesTeaser } from '@/features/itineraries/public-itineraries-teaser';

<ItineraryPicker
  value={itineraryId}                     // string | null
  selected={post?.itinerary ?? null}      // keeps the saved choice visible when it is on another page
  error={errors.itineraryId}              // backend 400 message; the picker re-reads its page (clear it in onChange)
  onChange={(id, summary) => { /* id: string | null, null = detach */ }}
  disabled={saving}
/>
{post.itinerary && <ItineraryPreview itinerary={post.itinerary} />}
<HomeContent itineraries={<PublicItinerariesTeaser />} />
```

- The picker reads `GET /api/itineraries?page=n` (server pages, no client merging). Only own PUBLIC, not hidden
  itineraries are selectable, mirroring `BlogService.assertAttachableItinerary`; private/hidden rows are shown
  disabled with the reason. "No itinerary" is always available; paging uses Arwa's `Pagination`.
- The blog API returns `itinerary: null` both for posts that never had one and for one that is no longer public, so
  render the preview only when there is one. Passing `null` shows "Itinerary not available" and nothing else.

## Admin preview routes (GEN-10, for Arwa's moderation pages)

| Route | Admin can open it? | Notes |
| --- | --- | --- |
| `/itineraries/[id]` | Yes, for any PUBLIC itinerary, hidden ones and deactivated authors included | Use for moderation links. Read-only with a "Hidden by an administrator" flag; no edit, clone or report controls; linked bookings never shown |
| `/explore/itineraries/[id]` | No (404 when hidden or the author is deactivated) | Anonymous public view |
| `/itineraries/[id]/edit` | No (404) | Owner only |
| Any PRIVATE itinerary | No (404), every route | ACC-11. Reports accept only PUBLIC trips, but an owner can make a reported trip private later |
| `GET /api/itineraries/hidden?page=n` | Yes (ADMIN only) | Hidden public itineraries, 10 per page |

Source of truth: `ItinerariesService.canRead`.

## Checks

```bash
cd frontend
npm run typecheck
npm run build
npm --prefix ../backend run build
npx playwright test -c playwright.itineraries.config.ts
```

The suite (16 journeys, all passing on the real backend) starts the compiled Nest app on a disposable Mongo replica
set with the official catalog, airports, an airline, flights and bookable hotels (port 3120), and the production Next
build (port 3121). Only the external FXRatesAPI client is replaced (always unavailable) and the backend's own rate
cache is seeded, so the real cache, stale and 503 logic runs. Real hotel and flight holds are created through the
booking APIs and marked paid in the disposable database, as the verified webhook would. To use an installed
Chromium, set `PLAYWRIGHT_EXECUTABLE_PATH`. `playwright.checkout.config.ts` uses the same ports: run them one after
the other.

Covered: guest redirect and return; create validation; day add/group/reorder/edit/delete with recalculated dates;
start-date change; private → public → private as a second traveler; owner-only edit; delete; activities with
attraction, time order, cost, photo upload/remove and non-image refusal; budget entries, transport and exact backend
totals in USD, EGP and EUR including the stale notice and the 503 message; public search with keyword/country/
length/sort and an invalid range; sign in to clone, independent private copy with attribution, revoked access;
ITN-25 stop dates, validation, reload and hand-off; ITN-26 trip-date defaults, infant rule, matching returns only
and the exact `FlightSelection`; ITN-27 covered days only, budget once, owner-only, unlink; ITN-28 real `%PDF`
download and error states; an expired session mid-edit (message, unsaved text kept, recovery after sign-in); a
100-character unbroken title at 360 px on every page; reporting once and the owner not seeing it; shared pagination
by URL; admin preview routes and their limits. No horizontal overflow at 360/768/1024/1440. Teammates' suites still
pass with this code (on 2026-11-28: login/account 29/29, flight bookings 34/34).

## Known limits

- **Hotel booking detail link.** Linked hotel bookings link to the `/bookings` hub until Osama's
  `/bookings/hotels/[id]` is on develop (one-line change in `linked-bookings-editor.tsx`).
- **Favourites (BON-02).** Osama's `FavoriteButton` is not on develop yet; it goes next to Clone/Report on public
  trips.
- **Report button account switch.** Arwa is resetting the shared `ReportAction` when the signed-in user changes;
  #170 is re-checked with two traveler accounts once her fix lands.
- **Not verified here:** the team's shared Atlas database, the real FXRatesAPI and real Stripe payments before
  linking (the disposable backend covers the same code paths), and the browser print dialog (headless).
