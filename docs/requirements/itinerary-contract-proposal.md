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

### Person 1 / Malak: authors (ACC-12)

Port `ITINERARY_AUTHORS`:

```ts
getAuthors(userIds: string[]): Promise<Map<string, { name: string; status: AccountStatus }>>
```

The planned shared method is `UsersService.getAccountStatuses(userIds)`, which returns
statuses only. **Requested adjustment:** also return `name`. Attribution needs it on public
itineraries and on clones (ITN-21). Without it, the module would have to read the User
collection directly.

How it is used:

- The authors of **all** matching public itineraries are looked up before pagination. Hidden
  authors are then excluded from the query, so `total` and page counts are correct.
- Visible means the author exists and is not `DEACTIVATED`. `SUSPENDED` authors stay visible.
- Author status is rechecked when viewing, cloning, viewing the budget summary,
  searching hotels or flights, and downloading images.
- Errors propagate, so a failed lookup never grants access.

Temporary binding: `InterimAuthorsAdapter` reads only `_id`, `name` and `status` from
`users`. Once the shared method exists, replace it with an adapter that calls `UsersService`.

### CurrenciesModule (PR #10)

Port `ITINERARY_CURRENCIES`: `listSupported()` and `isSupported(code)`. Temporary binding:
`InterimCurrenciesAdapter`, with the same seeded codes (AED, EGP, EUR, GBP, JPY, SAR, USD).
When synchronizing with `develop`, bind the port to `CurrenciesService` and import
`CurrenciesModule`. Currency conversion and FXRatesAPI handling stay in this module.

### Person 3: flight search (ITN-26)

Port `ITINERARY_FLIGHT_SEARCH.search(criteria)`. The criteria are `originCity`,
`originCountryCode`, `destinationCity`, `destinationCountryCode`, `departureDate`
(YYYY-MM-DD), `adults`, `children`, `infants`, `cabinClass` and `page`. The itinerary
supplies cities, not airports. Person 3 should say whether FlightsService can search by
city (through the airports dataset), or whether the itinerary should resolve airport
codes itself.

### Person 5: hotel search (ITN-25)

Port `ITINERARY_HOTEL_SEARCH.search(criteria)`. The criteria are `city`, `countryCode`,
`checkIn`, `checkOut`, `guests` and `page`. Check-in is the first day of the city stop.
Check-out is the morning after its last day.

Until the Flights and Hotels modules exist, these two endpoints return 503.

## 4. Decisions needed

| # | Question | Who | Proposal |
| --- | --- | --- | --- |
| 1 | Add `name` to the shared author lookup? | Malak (Person 1) | Yes, as in section 3. |
| 2 | How should a clone show its attribution once the original author is deactivated? | Team | Keep the clone visible to its owner, and show the author as "Deleted user" (ACC-12 wording). |
| 3 | Can flight search take cities? | Person 3 | Yes, through the airports dataset. |
| 4 | Is there a shared media/upload service (GEN-08)? The blog also needs images. | Team | For now, store bytes in `activityimages`; move them to the shared service if one is agreed. |
| 5 | Limits: 90 days, 30 activities and 50 budget entries per day, 100 transport costs, 5 images per activity of 5 MB each. | Check the workbook | Adjust the values in `itinerary.rules.ts`. |
| 6 | How are budget amounts stored? | Persons 4, 8 | Decimals with 2 places, rounded when totalled. This differs from booking prices, which use minor units for PAY-04, because budgets mix currencies such as JPY. |
| 7 | Which rates are used, and how fresh? | Team | Latest rates. Cached 1 hour; on provider failure, cached rates up to 7 days old are used and flagged as stale. |
| 8 | Who can create itineraries? | Team | Role USER only, the same as booking. Moderators and admins get 403. |
