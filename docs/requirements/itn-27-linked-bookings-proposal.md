# ITN-27 (optional bonus): link booked flights and hotels to itinerary days

Status: **proposal, not implemented.** Owner: Person 7 (Kenzy). Needs confirmation from
Person 4 (Ismail, flight bookings) and Person 6 (Osama, hotel bookings) before coding.

Requirement (workbook, Bonus!D8): *"The system shall allow booked flights and hotels to be
linked to itinerary days, feeding the budget."* Endpoint in PDF 8.8:
`POST /api/itineraries/:id/bookings` (ITN-27, optional).

## 1. What the itinerary needs from the booking modules

**No new methods are needed.** Both modules already export an owner-only lookup:

| Module | Method used | Fields read |
| --- | --- | --- |
| `FlightBookingsModule` (Person 4) | `FlightBookingsService.getMine(flightBookingId, userId)` | `status`, `totalAmount`, `currency`, `bookingReference`, `segments[]` (`departureAirportCode`, `arrivalAirportCode`, `departureAt`, `departureTimeZone`, `flightNumber`) |
| `HotelBookingsModule` (Person 6) | `HotelBookingsService.getMine(hotelBookingId, userId)` | `status`, `totalPrice`, `currency`, `bookingReference`, `hotelName`, `checkIn`, `checkOut`, `nights` |

Both already return 404 for another user's booking (ACC-11), so a user can only link their own
bookings.

**Questions for Ismail and Osama:**
1. Can we treat `getMine` and the fields above as a stable interface (no renames without telling
   Person 7)?
2. Amounts are USD integer minor units (PAY-04). Is it correct to show them as `amount / 100`?

The itinerary module will reach the services through ports (`ITINERARY_FLIGHT_BOOKINGS`,
`ITINERARY_HOTEL_BOOKINGS`), the same way it reaches flight and hotel search. No booking code is
edited.

## 2. Data stored on the itinerary

A new embedded array `Itinerary.linkedBookings[]`:

| Field | Meaning |
| --- | --- |
| `_id` (`linkedBookingId`) | Id of the link |
| `type` | `FLIGHT` or `HOTEL` |
| `bookingId` | `flightBookingId` or `hotelBookingId` |
| `dayId` | The itinerary day it belongs to |
| `linkedAt` | Timestamp |

Only the reference is stored. Amount, status and dates are **read live** from the booking module
each time, so a later cancellation or refund is shown correctly without syncing.

## 3. Endpoints

| Method | Endpoint | Who | Result |
| --- | --- | --- | --- |
| POST | `/api/itineraries/:id/bookings` | owner | Body `{ type, bookingId, dayId }`. Links the booking. (PDF 8.8, ITN-27) |
| DELETE | `/api/itineraries/:id/bookings/:linkedBookingId` | owner | Unlinks it. The booking itself is untouched. (Additional endpoint, needed to undo a link.) |

The linked bookings appear in `GET /api/itineraries/:id` for the owner, with live status and
amount.

## 4. Rules (proposed)

- **Owner only.** Only the itinerary owner can link, unlink or see links. Non-owners (including
  admins, ACC-11) viewing a public itinerary never see linked bookings, and their budget summary
  excludes them.
- **Only booked reservations.** Status must be `CONFIRMED` or `COMPLETED`. `PENDING`, `EXPIRED`
  or `CANCELLED` returns 400.
- **Day must match the booking dates.**
  - Flight: the day's date equals the first segment's local departure date.
  - Hotel: check-in ≤ the day's date < check-out.
  - Otherwise 400, naming the expected date(s).
- **No duplicates.** The same booking can be linked to an itinerary only once (409).
- **Limit:** at most 20 linked bookings per itinerary, so a summary needs at most 20 lookups.
- **Day deleted:** links on that day are removed with it. **Reordered:** links stay with their day.
- **Cloning:** links are never copied to a clone (bookings are personal).

## 5. Feeding the budget

In `GET /api/itineraries/:id/budget-summary`, for the owner only:

- A linked **hotel** booking counts as `ACCOMMODATION` on its day.
- A linked **flight** booking counts as booked transport on its day, as a separate
  `bookedFlights` line next to the manual intercity transport costs.
- Only `CONFIRMED` and `COMPLETED` bookings count. A link whose booking was later cancelled stays
  visible with status `CANCELLED` but adds 0.
- Amounts are converted to the display currency with the same FXRatesAPI rates as other budget
  entries. Booking prices themselves are never changed (PAY-04).
- If a booking lookup fails, the summary fails (no silent partial totals).

## 6. Tests planned

Link and unlink by the owner; 404 for another user's booking or itinerary; 400 for pending,
expired or cancelled bookings and for a day outside the booking dates; 409 duplicate; links hidden
from non-owners and not cloned; links removed with their day; summary totals with a cancelled
booking contributing 0; currency conversion of booking amounts.
