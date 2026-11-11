# Hotels, Rooms and Availability: shared contract

Status: approved by Malak on 2026-11-11; backend implementation on feature/FLT-28-seat-selection-and-flight-changes, PR103 into develop, pending review. Lama owns Hotels; Osama owns reservations/reviews. This replaces the stale pre-booking proposal. Source requirements are preserved in the Milestone 1 ownership matrix.

## Profiles and room metadata

Admin POST /api/hotels requires name, city, address, starClass (integer 1–5), and amenities (up to50 unique trimmed strings,1–100 characters each; [] is valid). countryCode disambiguates the official city catalog; description is optional. The assigned hotel moderator can PATCH their hotel. Existing photos, policy and audit flows are retained.

POST /api/hotels/:id/rooms requires name, type (1–80 trimmed characters), beds (positive safe integer), capacity and pricePerNight (positive safe integers). A trimmed room name is case-insensitively unique within its hotel, including inactive/legacy rooms. Concurrent creates/edits serialize through the existing Hotel/Room booking gates and a partial unique collation index covers completed records. Legacy duplicates/metadata are preserved: complete or rename them explicitly; no migration invents room types, bed counts or hotel stars.

Hotel detail/search expose averageRating and ratingCount from the shared visible-review reader. Hidden reviews do not contribute. ReviewsService.getRatingStats retains its interface by delegating to the same reader; no stored duplicate average or circular Hotels/Reviews module import is introduced. Detail is not a combined reviews/dated-room endpoint: those use their existing dedicated APIs.

## Positive availability and existing reservations

RoomAvailability remains one document per room with roomId, hotelId, timestamps, blockedRanges and bookedRanges. It now also stores bookableRanges: [{startDate,endDate}]. Dates are real YYYY-MM-DD and half-open: checkout is exclusive. Overlapping positive ranges fail400; adjacent ranges merge. A new/legacy room with no configured positive ranges is closed to NEW holds and absent from availability search.

The assigned moderator replaces positive availability with:

PUT /api/hotels/:id/rooms/:roomId/bookable-ranges
{"ranges":[{"startDate":"2026-12-01","endDate":"2027-01-01"}]}

[] closes new stays. A transaction acquires existing Hotel then sorted Room write gates, reads canonical reservations and refuses409 if any confirmed or live Pending stay loses coverage. Concurrent close versus hold cannot both succeed. Confirmed stays, their frozen price/policies and live pre-upgrade confirmation are retained; configuration changes do not silently cancel them.

Osama's existing RoomInventoryAdapter is reused/exported. New holds require full positive containment and no blocked/live-held/booked overlap. Expired holds are ignored by public reads immediately; holds and moderator block/edit paths remove elapsed HELD entries before their conditional writes. BOOKED ranges are never removed by expiry cleanup. Multi-room operations retain their existing transaction. Confirming an existing live hold does not require newly invented availability.

Existing moderator block/edit/unblock endpoints remain:
POST /api/hotels/:id/rooms/:roomId/availability
PATCH /api/hotels/:id/rooms/:roomId/availability
These exclusions are separate from configuring positive ranges. Existing room deactivation and provider/account gates remain in place.

## Search and read responses

GET /api/hotels/search accepts city OR countryCode, or both; destinations resolve against the official catalog. Required checkIn/checkOut/guests and optional rooms (default1) retain strict valid/future stay checks. A hotel must have enough active rooms free for the entire stay whose combined capacity covers guests. Price quote/filtering uses a room capable of participating in that selection. minPrice/maxPrice are inclusive USD minor-unit nightly amounts. minRating is1–5; unrated hotels are excluded when set. sort supports NAME, PRICE_ASC, PRICE_DESC and RATING_DESC (unrated last). Responses remain ten-item pages and now include starClass/amenities and visible rating aggregates.

GET /api/hotels/:id/rooms/available accepts checkIn/checkOut and optional guests/page. Response is now {items,page,pageSize:10,total,totalPages}, replacing the bare array. Each item includes roomId (plus retained _id alias), name/type/beds/capacity, pricePerNight, totalStayPrice and currency USD. totalStayPrice = nights × pricePerNight in integer minor units, with unsafe totals rejected. Metadata may be absent on uncompleted legacy records.

GET /api/hotels/:id/availability is assigned-moderator-only. It accepts from/to/page; omitted dates choose a30-day UTC window, maximum366 days. Response is {items,page,pageSize:10,total,totalPages,from,to}. All hotel rooms, including inactive rooms, are paginated. Each item includes roomId/name/isActive, positive/raw overlapping ranges and days[]:
- AVAILABLE: active, configured and unoccupied.
- BOOKED: confirmed reservation or live Pending hold. hotelBookingId and canonical bookingStatus are included; bookingReference appears only when one actually exists. A hold never receives an invented confirmed reference.
- BLOCKED: inactive, explicitly blocked or outside configured bookable dates.

Reservation references are joined through HotelBookingsService.availabilityReferences with hotel ownership in the query. No guest contact or payment details are exposed. The existing moderator reservations endpoint retains its agreed multi-room adapter: Confirmed, Completed and Cancelled plus only still-live Pending holds; expired holds are hidden. The inventory calendar separately represents nightly occupancy.

## Teammate handoff and deployment

Lama: send required metadata on create; explicitly complete old records and configure bookable ranges; read items on available-room/calendar pages. No blanket production availability is seeded.
Osama: reuse the adapter/gates and canonical reservation queries; maintain positive coverage and half-open dates; retain frozen price/policy snapshots, existing hold conversion, release/refund logic and references.
Kiki: existing shared hotel-search adapter remains the integration surface. Country-only/rating support adds capabilities without copying search logic.
Arwa: hotel-create requests now include starClass/amenities; existing audit transaction remains.

No new role, public booking status, environment variable or separate workflow file is added. Test fixtures explicitly configure positive dates in isolated MongoDB; they do not open Atlas rooms. Validation evidence and the review outcome are recorded in Malak's single work log. Full acceptance of unrelated hotel detail/media/delete criteria remains tracked separately in the matrix.

Validation: combined backend regression907/907,96 suites/67 test files, zero failures; production build passed. Full evidence is recorded in the single student log. PR103 is pending review, not a merged release.
