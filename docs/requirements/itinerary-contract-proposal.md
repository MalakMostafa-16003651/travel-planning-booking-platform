# Itineraries, Activities and Budgeting: shared contract

Status: **proposal; the cross-module interfaces are not yet agreed.** The code is Person 7's
(student 16001313). The module in `backend/src/itineraries` is built against this proposal,
so it can be reviewed while other modules are still being written. Each dependency on another
module goes through a port in `ports/`, with a temporary adapter in `adapters/`. When a
dependency lands, only its binding in `itineraries.module.ts` changes.

Sources: project PDF sections 5, 6.5 and 8.8, the team's naming rules, and the shared
decisions on currencies, ACC-11 and ACC-12 (2026-11-04). The reviewed requirements workbook
was **not** available while this was written. The limits marked "assumed" below must be
checked against it.

## 1. Requirements covered

| ID | Behavior |
| --- | --- |
| ITN-01 | Create, update and delete an itinerary: title, description, countries, start date, visibility, currency. |
| ITN-03 | List your own itineraries (page size 10) and view one. |
| ITN-05, ITN-07 | Add (append or insert at a position), edit and delete days. |
| ITN-08 | Reorder days. Day numbers, dates and city grouping follow the new order. |
| ITN-10, ITN-12 | Activities in a day, and activity images (GEN-08 upload validation). |
| ITN-14 | Budget entries per day: FOOD, ACCOMMODATION, ACTIVITIES, LOCAL_TRANSPORT. |
| ITN-16 | Intercity transport costs, stored separately from daily budgets. |
| ITN-18 | Budget summary converted into a display currency through FXRatesAPI. Handles invalid currencies, missing rates and provider failures. |
| ITN-20, ITN-21 | Public/private visibility; public search and view; cloning with attribution. |
| ITN-25, ITN-26 | Hotel and flight search from the itinerary, reusing the Hotels and Flights modules. |
| ACC-11 | Private itineraries are owner-only, including for admins. |
| ACC-12 | Public itineraries of deactivated authors are hidden but kept in the database. |

ITN-27 (attach bookings) and ITN-28 (PDF export) are optional bonuses and are not included.

## 2. Data model

One `Itinerary` document (collection `itineraries`) holds its ordered days. Each day holds
its activities and budget entries; the itinerary also holds its transport costs. PDF
section 5 allows embedding for bounded, parent-owned data. One document write keeps
ordering and totals consistent. Optimistic concurrency (`__v`) makes the second of two
simultaneous edits fail with 409, so no update is silently lost.

| Entity | Fields |
| --- | --- |
| `Itinerary` | `_id` (itineraryId), `userId`, `title`, `description`, `countries[]` (ISO alpha-2), `startDate`, `visibility` (`PRIVATE`/`PUBLIC`), `currency`, `days[]`, `transportCosts[]`, `clonedFrom`, `publishedAt`, timestamps |
| `ItineraryDay` | `_id` (dayId), `city`, `countryCode`, `notes`, `activities[]`, `budgets[]`. **No stored day number or date.** Both come from the day's position: date = `startDate + (dayNumber - 1)`. |
| `Activity` | `_id` (activityId), `title`, `description`, `location`, `attractionId`, `startTime`/`endTime` (`HH:mm`), `images[]` (metadata only) |
| `BudgetEntry` | `_id` (budgetId), `category`, `amount` (decimal, at most 2 places), `currency` |
| `TransportCost` | `_id` (transportCostId), `fromCity`, `toCity`, `mode`, `amount`, `currency`, optional `dayId`, `notes` |
| `ClonedFrom` | `itineraryId`, `userId`, `authorName`, `title`, `clonedAt` |
| `ActivityImage` (`activityimages`) | Image bytes, kept outside the itinerary document. This is an additional supporting entity, see decision 4. |
| `ExchangeRate` (`exchangerates`) | `baseCurrency` (unique), `rates`, `rateDate`, `fetchedAt` |

City grouping ("city stops") is computed on each read, as consecutive days in the same
city. The API returns it as `cityGroups`.

## 3. What this module needs from others

### Person 1 / Malak: account statuses (ACC-11, ACC-12)

Port `ITINERARY_ACCOUNT_STATUSES`, matching the agreed shared method exactly:

```ts
UsersService.getAccountStatuses(userIds: string[]): Promise<Map<string, AccountStatus>>
```

It returns entries only for users that exist. Every visibility decision uses only this
port:

- Visible means the author exists and is not `DEACTIVATED`. `SUSPENDED` authors stay
  visible. Missing authors are hidden.
- The authors of **all** matching public itineraries are looked up before pagination.
  Hidden authors are excluded from the query itself, so `total` and page counts only
  count itineraries the caller can open.
- Author status is rechecked when viewing (`/public/:id` and `/:id`), cloning, viewing the
  budget summary, searching hotels or flights, and downloading images. Hidden itineraries
  return 404. They stay stored with their `visibility` unchanged.
- Errors propagate (500), so a failed lookup never grants access. The owner's own access
  does not depend on this lookup.
- ACC-11: a private itinerary is owner-only, including for admins. Ownership is checked
  against `request.user.userId` set by the shared authentication guard.

Temporary binding: `InterimAccountStatusesAdapter`, with the same signature and
semantics, reads only `_id` and `status` from `users`. When the shared method lands, the
only change is in `ItinerariesModule`: import `UsersModule` and bind
`{ provide: ITINERARY_ACCOUNT_STATUSES, useExisting: UsersService }`.

**Adjustment needed: author names.** The shared method returns statuses only, but the
module shows the author's name on public itineraries and stores it in clone attribution
(ITN-21). Until UsersService offers a name lookup, port `ITINERARY_AUTHOR_NAMES`
(`UserAuthorNamesAdapter`) reads only `_id` and `name` from `users`. It is never used to
decide visibility: names are requested only for authors the status port allows, and
everyone else is shown as "Deleted user". Proposal: add
`UsersService.getDisplayNames(userIds: string[]): Promise<Map<string, string>>`, or accept
the read-only lookup.

### CurrenciesModule (PR #10)

Port `ITINERARY_CURRENCIES` (`listSupported()` and `isSupported(code)`) is bound with
`useExisting: CurrenciesService`, and `CurrenciesModule` is imported. The catalog is seeded
with AED, EGP, EUR, GBP, JPY, SAR and USD (`GET /api/currencies`). The itinerary currency
defaults to the user's `preferredCurrency` when it is in the catalog, else USD. Every
itinerary, budget, transport and summary currency is checked against the catalog (400
otherwise, listing the supported codes). Currency conversion and FXRatesAPI handling stay
in this module. Rates are requested only for catalog codes, and a provider response for a
different base currency is rejected as a provider failure.

### Person 3: flight search (ITN-26)

`GET /api/itineraries/:id/flights` (ITN-26) reuses the Flights module search (FLT-11,
FLT-12, FLT-15, `GET /api/flights/search`) through port `ITINERARY_FLIGHT_SEARCH.search(criteria)`. The criteria are `originCity`,
`originCountryCode`, `destinationCity`, `destinationCountryCode`, `departureDate`
(YYYY-MM-DD), `adults`, `children`, `infants`, `cabinClass` and `page`. The itinerary
supplies cities, not airports. Person 3 should say whether FlightsService can search by
city (through the airports dataset), or whether the itinerary should resolve airport
codes itself.

### Person 5: hotel search (ITN-25)

`GET /api/itineraries/:id/hotels` (ITN-25) reuses the Hotels module search (HTL-11,
HTL-12, `GET /api/hotels/search`) through port `ITINERARY_HOTEL_SEARCH.search(criteria)`. The criteria are `city`, `countryCode`,
`checkIn`, `checkOut`, `guests` and `page`. Check-in is the first day of the city stop.
Check-out is the morning after its last day.

Until the Flights and Hotels modules exist, these two endpoints return 503.

## 4. Decisions needed

| # | Question | Who | Proposal |
| --- | --- | --- | --- |
| 1 | Author names: the agreed `getAccountStatuses` returns statuses only. | Malak (Person 1) | Add `getDisplayNames`, or accept the read-only name lookup (section 3). Visibility uses statuses only either way. |
| 2 | How should a clone show its attribution once the original author is deactivated? | Team | Keep the clone visible to its owner, and show the author as "Deleted user" (ACC-12 wording). |
| 3 | Can flight search take cities? | Person 3 | Yes, through the airports dataset. |
| 4 | Is there a shared media/upload service (GEN-08)? The blog also needs images. | Team | For now, store bytes in `activityimages`; move them to the shared service if one is agreed. |
| 5 | Limits: 90 days, 30 activities and 50 budget entries per day, 100 transport costs, 5 images per activity of 5 MB each. | Check the workbook | Adjust the values in `itinerary.rules.ts`. |
| 6 | How are budget amounts stored? | Persons 4, 8 | Decimals with 2 places, rounded when totalled. This differs from booking prices, which use minor units for PAY-04, because budgets mix currencies such as JPY. |
| 7 | Which rates are used, and how fresh? | Team | Latest rates. Cached 1 hour; on provider failure, cached rates up to 7 days old are used and flagged as stale. |
| 8 | Who can create itineraries? | Team | Role USER only, the same as booking. Moderators and admins get 403. |
