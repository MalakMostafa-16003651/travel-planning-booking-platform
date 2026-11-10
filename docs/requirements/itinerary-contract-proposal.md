# Itineraries, Activities and Budgeting: shared contract

Status: implemented backend corrections on `develop`. Both search ports are connected: ITN-25 to `HotelsService.search` and ITN-26 to `FlightsService.searchForItinerary` (see below). Person 7 owns this module. Malak's explicitly authorized fixes and tests are recorded in docs/work-logs/16003651.md; no changes are attributed to Kiki that she did not perform.

Sources: reviewed requirements workbook (ITN-01 through ITN-26, GEN-08, ACC-09/11/12), revised project PDF sections 5.1 and 8, and team-leader-approved reference schema design on 2026-11-06. Milestone 1 is backend only.

## Shared Users integration

Import UsersModule; inject UsersService. The itinerary ports use the same shared instance:

```ts
getAccountStatuses(userIds: string[]): Promise<Map<string, AccountStatus>>
getDisplayNames(userIds: string[]): Promise<Map<string, string>>
```

IDs are validated, normalized and deduplicated. Missing users do not produce entries; only IDs and requested public fields are selected. Display names exclude DEACTIVATED accounts. Errors propagate; these helpers are internal services, not new user-directory HTTP endpoints. The temporary direct-collection status/name adapters are removed.

Private itineraries remain owner-only, including for admins. Public visibility requires an existing ACTIVE or SUSPENDED author; DEACTIVATED/missing authors are hidden before pagination/counts and rechecked for direct viewing/cloning/images/search. Lookup errors never grant public access. Once ownership is established from the authenticated identity, the owner's own response does not depend on another status check. If original-author attribution is unavailable on an owner's clone response, use Deleted user without exposing an unverified name. Stored visibility is preserved on account deactivation.

## Official reference data and currencies

One approved ReferenceDataModule owns countries and cities. Country has code/name/currency; City has cityId/name/countryCode. Both have MongoDB _id/createdAt/updatedAt. Unique indexes preserve country codes and the official city_id values (mapped to cityId, including new_york). No teammate should define another Country/City model or private allowed list.

ReferenceDataService exports listCountries/listCities/assertCountries/resolveCity/matchingCountryCodes and an explicit idempotent seedSupported setup method. Public GET /api/countries and GET /api/cities return only documented reference fields. Setup: npm.cmd run seed:references from backend. Startup initializes indexes without inserting rows. The seed uses the eight official records per dataset, preserves existing IDs/data and never deletes extra rows. Public/validation queries select official identifiers only. Atlas setup is a separate operator action after review; tests seed their own local database.

Countries must be official catalog entries. Days use a canonical official city and its matching country; their country must be among the itinerary's selected countries. Changing selected countries cannot strand existing days. Kiki/Gamila/Lama can all reuse this module. Airport data remains owned by Gamila.

CurrenciesService remains the single shared source for profile, itinerary, activity, budget and transport currencies. Its supported queries now expose/accept only the codes from Countries.csv: AED, EGP, EUR, GBP, JPY, SAR, USD. Extra stored rows are preserved but are not automatically supported. Currency conversion stays in the itinerary module; booking/payment prices are unchanged.

## Itinerary, activity and budget behavior

- ITN-01: title max 100 characters; official countries, real start date, private by default. Owner update/delete and independent clones remain.
- ITN-05/07/08/09: at most 60 days, stable child IDs, sequential derived dates/numbers, consecutive-city grouping, optimistic-concurrency conflict 409. Remaining technical bounds (30 activities/50 daily budgets/100 transport entries) are implementation limits, not invented workbook requirements.
- ITN-10: an activity can have optional non-negative cost (max two decimals) and a supported currency. Cost currency defaults to itinerary currency when first supplied and is stored, so later itinerary preference changes do not relabel the amount. A currency without a cost is rejected. Costs, including zero, survive cloning and count once under ACTIVITIES.
- ITN-14/16: transport creation requires dayId belonging to the itinerary. Changing its day requires another owned day. Deleting a day removes transport entries assigned to that day along with that day's activities/budgets. Summary day/city totals include their transport; overall transport stays separate from the four daily categories, avoiding double counting.
- ITN-18: authenticated summary defaults to the current user's supported preferredCurrency, then itinerary currency. Guests use itinerary currency; explicit supported display currency overrides the default. Latest rates are cached once per UTC calendar day, with concurrent per-process requests sharing a fetch. If the provider fails, use the last cached snapshot regardless of age and show rate date/ratesStale. No usable cache gives 503; missing required rate gives 422. Provider base mismatches are rejected. No raw key or payment conversion is exposed.
- ITN-21: keyword search includes country names/codes as well as title/description/city; public-author visibility remains part of every search.
- GEN-08: JPG/PNG only, at most 5 MB and 5 images per activity, bytes stored server-side and served by protected/read-authorized URL. WebP is rejected.

Existing transport entries without dayId remain readable/editable as part of the parent, without a destructive migration. Updating such an entry requires assigning an owned dayId first. Until reassigned, its amount remains in the overall transport total without an invented day allocation. All new entries require dayId.

## Search ports requiring owner integration

These request contracts are corrected to the workbook and documented for coordination. Tests inject search doubles to verify the criteria the itinerary derives.

### ITN-25 / Lama

GET /api/itineraries/:id/hotels takes dayId, guests, rooms and optional page. The city stop determines city/countryCode/checkIn/checkOut. Check-in is its first day; check-out is the day after its last. The HotelSearchPort receives city, countryCode, checkIn, checkOut, guests, rooms, page. Reuse HTL-11/12 rather than copying hotel availability logic.

**Connected (2026-11-08, Person 7).** These fields are exactly `SearchHotelsQueryDto` minus the optional price filters and sort, so `HotelsServiceSearchAdapter` passes them to the exported `HotelsService.search` unchanged and returns its `HotelSearchPage`. ItinerariesModule imports HotelsModule; no Hotels code was edited. HotelsService resolves the city through the shared ReferenceDataModule, so the search returns matches only once the countries/cities Atlas seed has been run. Lama: please confirm this is how you want the search reused.

### ITN-26 / Gamila

GET /api/itineraries/:id/flights takes departureAirportCode, roundTrip, optional departureDate/returnDate, adults/children/infants, cabinClass and page. The official airports in the first itinerary day's city determine arrivalAirportCodes. Departure defaults to itinerary start; round-trip return defaults to the last itinerary day. Airports must exist, arrival/departure cannot be identical, return cannot precede departure, at least one adult is required and infants cannot outnumber adults. FlightSearchPort receives departureAirportCode, arrivalAirportCodes, roundTrip, departureDate, optional returnDate, counts, optional cabinClass/page. Gamila must confirm the adapter mapping to FLT-11/12/15; no direct FlightsService implementation is edited in this batch.

**Review against FlightsService on `develop` (2026-11-08, Person 7). The port can't be connected as written:**

1. **One airport vs several.** The port sends `arrivalAirportCodes[]` (every official airport in the destination city). `FlightsService.search` and `searchRoundTrip` take a single `arrivalAirportCode`.
2. **Pagination happens inside FlightsService.** `search` returns one page of 10, and the method that returns the full list (`searchOneWay`) is private. Calling `search` once per airport and merging the pages would give wrong totals, page contents and sort order across airports.
3. **Two result shapes.** One-way returns `{ items, page, pageSize, total }`; round trip returns `{ outbound, return }`, each paginated. The adapter would branch on `roundTrip` (the port's `unknown` return type allows this).
4. Cabin classes already match `CabinClass` (ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST), and the passenger rules match FLT-11.

**Options (needs a decision from Gamila and the team leader):**
- **A, no Flights change (Person 7 proposal):** the itinerary sends a single `arrivalAirportCode`. It accepts an optional `arrivalAirportCode` query parameter that must be one of the first city's official airports, defaulting to that city's only airport, and returns 400 listing the choices when there are several. The adapter then calls `search` or `searchRoundTrip` directly.
- **B, Flights change (Gamila):** FlightsService exposes a public search that accepts several arrival airports and paginates the combined, sorted list.

**Decision: option B (2026-11-09).** Gamila added `FlightsService.searchForItinerary(criteria)`, which takes the port's criteria unchanged. It runs the FLT-11 one-way search for each destination airport (and each return leg), merges and sorts by departure time, then paginates once (10 per page). One-way returns `{ items, page, pageSize, total }`; round trip returns `{ outbound, return }`, each paginated, keeping only returns that leave after an outbound arrival. FlightsModule exports `ItineraryFlightSearchAdapter`, and ItinerariesModule binds it with `{ provide: ITINERARY_FLIGHT_SEARCH, useExisting: ItineraryFlightSearchAdapter }`. The itinerary keeps its own validation (airports exist, departure differs from every destination, return date, passenger counts).

Optional ITN-27/28 remain outside this work. Account deactivation itself and its booking-confirmation safeguards remain Person 1's separate ACC-12 task.

## Read-only views exported to other modules (BLG-12, BLG-13)

Added 2026-11-10 at Omar's offer, so the blog follows the itinerary visibility rules
automatically instead of querying the `itineraries` collection directly. Import
`ItinerariesModule` (it exports `ItinerariesService`); there is no circular import.

```ts
// BLG-12 author page: the author's PUBLIC itineraries, newest published first, page size 10.
listPublicByAuthor(authorId: string, page?: number): Promise<ItineraryPageDto>

// BLG-13 post attachment: one PUBLIC itinerary summary, or null. With authorId, it must belong
// to that user (use it both to validate an attachment and to render it).
getPublicSummary(itineraryId: string, authorId?: string): Promise<ItinerarySummaryDto | null>
```

Both apply the same rules as public search and viewing:

- Only `PUBLIC` itineraries. Private ones return nothing, even for their owner.
- An author who is `DEACTIVATED` or missing (ACC-12) gets an empty page, and their itinerary
  summary is `null`. `SUSPENDED` authors stay visible.
- Only summary fields are read. Activities, budgets and linked bookings never leave the module.
- Clone attribution shows "Deleted user" for a deactivated or missing original author.
- Invalid ids return an empty page or `null`, never an error.
- A failed account-status lookup throws (fail closed), so it never grants access.

