# M2 itineraries frontend (Person 7, Kiki — 16001313)

Status of the itinerary domain UI on this branch. Backend contracts are unchanged from M1:
`backend/src/itineraries` (controllers, DTOs) and Swagger at `/api/docs`.

## Slice 1 — trip and day editor (this PR)

| Requirement | Where | Notes |
| --- | --- | --- |
| ITN-01 | `/itineraries/new`, editor "Trip details", "Delete itinerary" | Title 1–100, catalog countries (≥1), start date, private by default. Delete needs confirmation. Countries already used by a day are locked (the backend rejects removing them). |
| ITN-03 | `/itineraries`, `/itineraries/[id]` | Server pages, most recently updated first, page size 10 from the API's own `page`/`totalPages`. |
| ITN-05 | editor "Add a day", day "Edit" | City select offers only official catalog cities of the selected countries; optional insert position; notes. Dates come from the backend. |
| ITN-07 | day "Delete day N" | Confirmation explains removed activities/budgets/transport/linked bookings and renumbering. |
| ITN-08 | ↑/↓ buttons (keyboard and screen-reader accessible), drag handle as a pointer shortcut | Both send `PATCH /days/reorder` with every dayId. |
| ITN-09 | city groups in editor and view | Rendered from the backend `cityGroups` (never recomputed client-side). Group budget subtotals arrive with the budget slice. |
| ITN-20 | editor "Visibility" | Confirmed toggle; making it private removes other users' access immediately (proved in the browser suite). |
| ACC-11, GEN-02/03/04/16 | all pages | Others' private trips → 404; owner-only edit (server check + backend). Inline field errors (client + backend `errors`), confirmations, empty states, saving/saved/error live region, 409 "reload latest version". |

### Rendering choices

- `/itineraries`, `/itineraries/[id]`, `/itineraries/[id]/edit`: **dynamic SSR, `no-store`**, fetched with only the viewer's auth cookies (`features/itineraries/server.ts`). The same `[id]` URL serves a private trip to its owner and a public trip to anyone, so it must never be shared-cached.
- The editor is a Client Component seeded with the server response. Every itinerary mutation returns the full recomputed `ItineraryDto`, which replaces local state — day numbers, dates and groups are always the server's.
- `/itineraries/new`: static shell + client form behind `RequireSession role="USER"` (the backend allows only USER to create).
- Public static/ISR discovery (`/explore/itineraries`) is the next slice; its invalidation on privacy change will be documented there.

### Reused shared pieces (no new shared infrastructure)

Malak's Button/Input/Select/FormField/Card/Badge/ConfirmDialog/Empty/Loading/Error, `apiClient`,
`getServerSession`, `loginHref`; Lama's `DateOnlyInput`/`date-only` helpers and the
`useDestinations` country/city catalog hook. A small local `Pager` stands in until Arwa's
shared Pagination lands on develop. Money uses `formatMoneyMajorUnits` (itinerary amounts are major units).

### Checks

```bash
cd frontend
npm run typecheck
npm run build
npm --prefix ../backend run build
npx playwright test -c playwright.itineraries.config.ts
```

The suite starts the real compiled Nest app on a disposable Mongo replica set (port 3120)
with the official catalog seeded, and the production Next build on 3121. To use an already
installed Chromium set `PLAYWRIGHT_EXECUTABLE_PATH`. Journeys: guest redirect to sign-in;
create validation; add/group/reorder/edit/delete days with date recalculation; start-date
change; private/public/private access as a second traveler; owner-only edit; delete
itinerary; no horizontal overflow at 360/768/1024/1440 (screenshots in ignored `test-results/`).

## Slice 2 — activities, photos, budgets, transport and FX totals

| Requirement | Where | Notes |
| --- | --- | --- |
| ITN-10 | day panel "Activities and budget for day N" → Activities | Title ≤120, optional time range (end not before start), location, official attraction limited to the day's city, optional cost + catalog currency. On edit an emptied cost sends `cost: null` (removed from totals); an emptied time sends `null` (the DTO rejects `""` for times). |
| ITN-12, GEN-08 | photos under each activity | Lama's `MediaUploader` with the activity endpoint (`POST /activities/:id/images`, field `image`), JPG/PNG ≤5 MB, five per activity, progress and remove. Images load through the same-origin proxy with the itinerary's visibility. |
| ITN-14 | day panel → Budget entries | Food/Accommodation/Activities/Local transport, non-negative, ≤2 decimals, catalog currency, description ≤500. |
| ITN-16 | "Intercity transport" | Any official catalog city (backend rule), mode, amount/currency, required travel day, notes. |
| ITN-18 | Budget side panel (editor) and read view | `GET /budget-summary` re-read after every saved change; "Show totals in" any catalog currency (default: viewer's preferred currency). Shows grand/category/daily/transport totals, per-day table, per-stop totals, amounts as entered, rate date, a stale-rate notice (`ratesStale`) and clear 503/422 errors with retry. No conversion happens in the browser. |
| ITN-09 | city group headers | "Subtotal" from the summary's `byCity`, matched by the group's first day. |
| ITN-21 (read part) | `/itineraries/[id]` | Public viewers see activities, photos, budget entries, transport and the budget panel; no edit controls. Linked bookings stay owner-only (backend). |

Layout follows the team rule "day/city hierarchy and side budget": on ≥1024 px the budget is a sticky side column; on phones it stacks under the days.

Browser proof (`tests-itineraries`, now 5/5): one journey adds an attraction activity (with time-order validation), uploads and removes a photo (non-image refused), adds EGP and USD entries and a London→Cairo flight, and checks the backend totals: $435.50, then $410.00 after clearing the activity cost/times, EGP 20,500.00 and €328.00 with the stale-rate notice, the 503 message for a currency with no rates, $310.00 after deleting an entry, and the same figures in a second traveler's read-only view. The harness replaces **only** the external FXRatesAPI client (always "down") and seeds the backend's own rate cache, so the real caching/fallback code runs.

## Slice 3 — public discovery, clone and shared components

| Requirement | Where | Notes |
| --- | --- | --- |
| ITN-21 search | `/explore/itineraries` | Plain GET form, so the URL is the state (shareable, survives refresh/back, works before JS): keyword, country, city, min/max days (min ≤ max checked before the request), sort (newest, oldest, title, shortest, longest), server pages of 10. Friendly empty states for "no matches" and "none yet". |
| ITN-21 view + clone | `/explore/itineraries/[id]` (also offered on a public `/itineraries/[id]` for non-owners) | Read-only with author, days, activities, photos, budget. Guests get "Sign in to clone" and return to the trip after login (ACC-10). Non-traveler roles are told only travelers can clone. Clone → your private copy's editor with a notice; "Cloned from … by …" attribution. The owner sees "Edit your itinerary" instead. |
| BLG-13 handoff → Hicham | `ItineraryPicker`, `isAttachable`, `ItineraryPreview` in `features/itineraries/` | See the contract below. Live example at `/dev/ui/itineraries` (development only). |
| Home slot → Malak | `PublicItinerariesTeaser` (Server Component) | For `<HomeContent itineraries={<PublicItinerariesTeaser />} />`. Not placed by Person 7: the landing page owns placement. |

### Handoff contract for Hicham (BLG-13)

```tsx
import { ItineraryPicker } from '@/features/itineraries/itinerary-picker';
import { ItineraryPreview } from '@/features/itineraries/itinerary-preview';

<ItineraryPicker value={itineraryId} onChange={(id, summary) => { /* id: string | null */ }} disabled={saving} />
<ItineraryPreview itinerary={post.itinerary /* ItinerarySummary | null from the blog API */} />
```

- Picker reads `GET /api/itineraries?page=n` (the author's own, server-paginated). Only `visibility: PUBLIC` and not `isHidden` are selectable, which mirrors `BlogService.assertAttachableItinerary`; private/hidden rows are shown disabled with the reason.
- Send the chosen id as `itineraryId` on create/update; `null` detaches. The backend re-checks and returns 400 `errors.itineraryId` if it became private or hidden meanwhile: show that error and let the author pick again.
- Preview renders the post's `itinerary` field exactly as returned (`ItinerarySummaryDto` or `null`). `null` (made private, hidden, deleted, author deactivated) shows "Itinerary not available" and nothing else. It links to `/explore/itineraries/[id]`.
- Pages that show the preview must stay uncached or revalidate on the same basis as the post, since visibility can change after attachment.

### Rendering decision for public pages

`/explore/itineraries` and `/explore/itineraries/[id]` are **dynamic SSR, anonymous (no cookies forwarded), never cached**. ISR was considered (description section 9) and rejected for itineraries: a trip can stop being public through actions this domain cannot observe or invalidate (an admin hiding it via GEN-10, the author's account being deactivated via ACC-12), so any cached copy could keep exposing content that must disappear "immediately" (ITN-20). Only the country/city catalogs are cached (5 minutes). The team's static/ISR example is better placed on content whose invalidation the owner fully controls.

Browser proof added (suite now 7/7): guest keyword/country/length/sort search where private trips never appear and an invalid range is explained; guest → sign in → returned → clone → independent private copy with attribution; author makes the original private → its public page 404s and it leaves search while the clone survives. Picker verified in `next dev` against the same disposable backend (private disabled, emitted `{"itineraryId": …}` matches the chosen trip).

## Remaining Person 7 slices

1. Travel reuse: ITN-25 hotel search for a city group (Lama's HotelSearch prefill) and ITN-26 flight search (Gamila's FlightSearch prefill).
2. Bonuses: ITN-27 linked bookings (Ismail/Osama booking readers) and ITN-28 PDF via the existing `GET /api/itineraries/:itineraryId/pdf` (PR #58).
3. Mount Osama's FavoriteButton (BON-02) and Arwa's ReportAction (GEN-09) on public itineraries when they reach develop (mount point marked in `/explore/itineraries/[id]`).
