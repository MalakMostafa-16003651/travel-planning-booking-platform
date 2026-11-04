# Travel Planning and Booking Platform

GIU Software Project I — Winter 2026

Backend: NestJS  
Frontend: Next.js  
Database: MongoDB Atlas

## Current implementation

ACC-01 user registration is the first implemented backend feature. It
accepts name, email, password, and terms-and-privacy consent; creates a `USER`
account with `ACTIVE` status; stores a salted password hash; and returns only
public account fields. ACC-04 adds login for the agreed roles, protected access and
refresh cookies, and `/api/auth/me` with server-side session/account checks.
ACC-05 locks new logins for 15 minutes after five consecutive failures and resets
the counter after successful login. ACC-06 adds current-browser logout with server
revocation and cookie clearing, plus server-side 30-minute inactivity enforcement.
Automatic token refresh remains outside these requirements; access tokens currently
expire after 15 minutes and require logging in again.

See [backend setup and authentication API documentation](backend/README.md) for
installation, environment configuration, Swagger, manual checks, and isolated
MongoDB tests.

The [Authentication and Users shared contract](docs/requirements/authentication-contract-proposal.md)
records the accepted User fields and naming, along with details deferred to later
features.

## Student workflow record

The [Person 1 workflow record](docs/work-logs/16003651.md) contains the agreed rules,
requirements, AI collaboration history, verification, learning checks, and reusable
team prompt. Each student keeps one continuous file named with their confirmed ID.
