# Travel Planning and Booking Platform

GIU Software Project I — Winter 2026

| Layer | Technology |
| --- | --- |
| Backend (Milestone 1) | NestJS 12, TypeScript, Mongoose, Swagger UI |
| Database | One shared MongoDB Atlas database (replica set; transactions are used) |
| Frontend (Milestone 2) | Next.js (not part of Milestone 1) |
| Payments | Stripe **test mode** (PaymentIntents and Refunds; card data never reaches the backend) |
| Exchange rates | FXRatesAPI, called only from the backend and cached daily in MongoDB |

The official requirements workbook (104 mandatory and 11 bonus IDs) and the project description PDF are
authoritative. [docs/requirements/milestone-1-ownership-matrix.md](docs/requirements/milestone-1-ownership-matrix.md)
gives every requirement ID with its full text, its owner and its current backend status.

## Repository layout

```
backend/            NestJS API (feature modules under backend/src, tests under backend/test)
docs/requirements/  ownership matrix and the agreed shared contracts between modules
docs/work-logs/     one continuous workflow record per student
AI_PROMPTS.txt      AI prompt log required by the project description (section 11.1)
.env.example        names of every environment variable, without values
```

Backend modules, by the team's eight-person split:

| Person | Area | Modules |
| --- | --- | --- |
| 1 | Authentication & users | `auth`, `users`, `currencies`, `reference-data`, `common` |
| 2 | Admin, moderation, notifications, audit | `admin`, `admin-analytics`, `reports`, `notifications`, `audit-logs` |
| 3 | Airlines, airports, flights, flight search | `airlines`, `airports`, `flights` |
| 4 | Flight bookings and seat holds | `flight-bookings` |
| 5 | Hotels, rooms, availability, hotel search | `hotels` |
| 6 | Hotel bookings and reviews | `hotel-bookings`, `reviews` |
| 7 | Itineraries, activities, budgets, exchange rates | `itineraries`, `itinerary-exports` |
| 8 | Payments, refunds, blog | `payments`, `blog` |

## Setup

1. Install **Node.js 24** with npm.
2. Copy `.env.example` to `.env` in the **repository root**. Fill in the values privately and never commit them:

   | Variable | Required | Purpose |
   | --- | --- | --- |
   | `MONGODB_URI` | yes | The team's shared Atlas connection string, including the database name. |
   | `JWT_SECRET` | yes | Random secret of at least 32 bytes for signing session tokens. |
   | `PORT` | no | HTTP port, default `3000`. |
   | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | for payments | Stripe **test** secret key (`sk_test_...`) and the webhook signing secret from `stripe listen`. Without them, payment calls return 503. |
   | `FXRATES_API_KEY` | for exchange rates | FXRatesAPI key, kept server-side. Without rates, the budget summary falls back to the last cached rates (503 if none were ever cached). |
   | `SMTP_*`, `PASSWORD_RESET_URL`, `EMAIL_VERIFICATION_URL`, `EMAIL_VERIFICATION_REQUIRED` | no | Optional bonus email features (ACC-02, ACC-07, GEN-01-B). Leave blank to keep email off. |

3. From `backend/`, install and seed the shared database. Each seed command is safe to run again: it adds missing records and never deletes or changes existing ones.

   ```bash
   npm ci
   ```

   ```bash
   npm run seed:references
   ```

   ```bash
   npm run seed:airports
   ```

   ```bash
   npm run seed:currencies
   ```

   ```bash
   npm run seed:admin
   ```

   `seed:references` loads the official countries, cities and attractions; `seed:airports` the airports with
   their IANA time zones; `seed:currencies` the supported currencies (GEN-12). `seed:admin` creates an
   administrator interactively. There is no admin self-registration (ACC-18).

4. Run the API:

   ```bash
   npm run start:dev
   ```

   Swagger UI: <http://localhost:3000/api/docs> (OpenAPI JSON at `/api/docs-json`). Log in with
   `POST /api/auth/login`; the browser then sends the httpOnly session cookies automatically (ACC-19).
   All routes use the `/api` prefix. Money is in integer minor units of USD (PAY-04), and every list has
   10 items per page (GEN-05).

On Windows PowerShell, use `npm.cmd` instead of `npm`.

## Tests

```bash
npm test
```

From `backend/`. The suites start their own temporary local MongoDB replica set (the binary is downloaded
once into `node_modules/.cache`) and use fake Stripe, mail and exchange-rate gateways. They never read
`.env` or touch the shared Atlas database. A full run takes about 20 minutes.

## Further documentation

- [Backend README](backend/README.md): per-feature API notes, manual Swagger checks and setup details.
- Shared contracts: [authentication](docs/requirements/authentication-contract-proposal.md),
  [admin](docs/requirements/admin-contract-proposal.md), [flight booking](docs/requirements/flight-booking-contract-proposal.md),
  [hotels](docs/requirements/hotel-contract-proposal.md), [hotel booking](docs/requirements/hotel-booking-contract-proposal.md),
  [itineraries](docs/requirements/itinerary-contract-proposal.md), [ITN-27 linked bookings](docs/requirements/itn-27-linked-bookings-proposal.md).
- AI usage: [AI_PROMPTS.txt](AI_PROMPTS.txt) and the per-student records in [docs/work-logs](docs/work-logs).

## Git workflow

`main` holds stable milestone releases and `develop` is the integration branch; nobody commits to either
directly or force-pushes them. Work happens on `feature/<ID>-<description>`, `fix/<ID>-<description>`,
`refactor/<description>` or `docs/<description>` branches from the latest `develop`, synchronized
regularly, and is merged back through a reviewed pull request that cites its requirement IDs. Commits use
`feat(scope): ...`, `fix(scope): ...`, `refactor(scope): ...` or `docs(scope): ...`.
