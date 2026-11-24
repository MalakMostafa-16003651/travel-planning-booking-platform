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

## Remaining Person 7 slices

1. Activities (ITN-10) with Lama's media uploader (ITN-12), budgets (ITN-14), transport (ITN-16), budget summary/FX with rate date and stale fallback (ITN-18), group subtotals (ITN-09).
2. Public discovery `/explore/itineraries[/id]` and clone (ITN-21), home "Explore itineraries" slot, Osama's FavoriteButton and Arwa's ReportAction mounts, `ItineraryPicker`/`Preview` for Hicham (BLG-13).
3. Travel reuse: ITN-25 hotel search for a city group (Lama's HotelSearch prefill) and ITN-26 flight search (Gamila's FlightSearch prefill).
4. Bonuses: ITN-27 linked bookings (Ismail/Osama booking readers) and ITN-28 PDF/print. Note: `develop` has **no** itinerary PDF export endpoint; ITN-28 needs either a backend endpoint (Person 7 backend) or an authorized print view — decision pending.
