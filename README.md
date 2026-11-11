# Travel Planning and Booking Platform

GIU Software Project I — Winter 2026

Backend: NestJS  
Frontend: Next.js  
Database: MongoDB Atlas

## Current implementation

The backend includes user registration, login/logout, profile updates, password changes/reset, verification, account deactivation, reusable guards and role/ownership enforcement. The detailed authentication sequence below records the implemented features; the current [ownership matrix](docs/requirements/milestone-1-ownership-matrix.md) tracks all eight modules, open audit findings and optional bonuses.

ACC-01 registration
accepts name, email, password, and terms-and-privacy consent; creates a `USER`
account with `ACTIVE` status; stores a salted password hash; and returns only
public account fields. ACC-04 adds login for the agreed roles, protected access and
refresh cookies, and `/api/auth/me` with server-side session/account checks.
ACC-05 locks new logins for 15 minutes after five consecutive failures and resets
the counter after successful login. ACC-06 adds current-browser logout with server
revocation and cookie clearing, plus server-side 30-minute inactivity enforcement.
ACC-07a adds administrator-set temporary passwords and restricted first-login
password changes; ACC-08 adds current-password changes for every logged-in role.
Password updates invalidate earlier sessions. Shared authentication and role
guards are available to the team.
ACC-09 adds own-profile viewing/updating and a shared currency catalog for
profile preferences and itinerary budgets.
Automatic token refresh remains outside these requirements; access tokens currently
expire after 15 minutes and require logging in again.

See [backend setup and authentication API documentation](backend/README.md) for
installation, environment configuration, Swagger, manual checks, and isolated
MongoDB tests.

The [Authentication and Users shared contract](docs/requirements/authentication-contract-proposal.md)
records the accepted User fields and naming, along with details deferred to later
features.

The [flight booking contract proposal](docs/requirements/flight-booking-contract-proposal.md)
records what flight booking and seat holds need from Flights and Payments, along with
the decisions still open for the team.

The [hotel contract proposal](docs/requirements/hotel-contract-proposal.md) records
the proposed Hotel/Room/RoomAvailability schemas, the HTL-01 through HTL-22
endpoints, and what Hotels needs from and exports to Payments and the (not yet
built) hotel-booking module.

## Student workflow record

The [Person 1 workflow record](docs/work-logs/16003651.md) contains the agreed rules,
requirements, AI collaboration history, verification, learning checks, and reusable
team prompt. Each student keeps one continuous file named with their confirmed ID.

The [Person 7 workflow record](docs/work-logs/16001313.md) and the
[Person 5 workflow record](docs/work-logs/16002622.md) follow the same format for
Itineraries and Hotels respectively. The [Person 4 workflow record](docs/work-logs/16002979.md)
covers flight bookings and seat holds.
