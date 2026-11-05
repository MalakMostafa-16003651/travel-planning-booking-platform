# Backend: registration and login

This NestJS 12 backend implements registration, login/lockout, logout/inactivity, administrator-assisted reset, password changes and ACC-09 own-profile viewing/updating using TypeScript, Mongoose and MongoDB Atlas. It also provides the shared currency catalog for profiles and budgeting. Registration creates a normal account without logging it in; `/api/auth/me` returns the authenticated identity. Optional token renewal remains later work.

## Run locally

Install Node.js 24 LTS with npm. Create the repository-root `.env` using the root `.env.example`, and enter the team's private connection string locally. Keep `.env` out of Git.

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Required connection string for the team's MongoDB Atlas database. |
| `JWT_SECRET` | Required private signing secret: at least 32 bytes, generated randomly. Placeholders and trivial repeated values are rejected; never reuse a database password or share this value in prompts. |
| `PORT` | Optional HTTP port; defaults to `3000`. |

When launched from `backend/`, the application reads the repository-root file at `../.env`. Startup validates both the database configuration and JWT signing secret. Only the credential-free `.env.example` belongs in Git.

Run these commands in a terminal whose current directory is `backend/`:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run start:dev
```

`npm ci` installs the exact locked dependencies. `npm run build` compiles TypeScript. `npm run start:dev` watches TypeScript files and restarts the Nest application after each successful compilation. The examples use `npm.cmd` so they work with Windows PowerShell's default execution policy; use `npm` on macOS or Linux.

To run the compiled application, stop the development server and use:

```powershell
npm.cmd run build
npm.cmd run start:prod
```

With the default port, open:

- Swagger UI: <http://localhost:3000/api/docs>
- OpenAPI JSON: <http://localhost:3000/api/docs-json>

Use the configured port in both URLs if `PORT` is changed. Startup requires a working MongoDB connection and valid JWT_SECRET.

## Registration API

`POST /api/auth/register` accepts a JSON body:

```json
{
  "name": "Travel Tester",
  "email": "travel.tester@example.com",
  "password": "Travel2026",
  "termsAccepted": true
}
```

| Field | Rules |
| --- | --- |
| `name` | A name string; surrounding whitespace is trimmed. |
| `email` | A valid email address; surrounding whitespace is trimmed and letters are converted to lowercase before storage. It must be unique. |
| `password` | At least eight characters, including at least one Unicode letter and one Unicode decimal digit. |
| `termsAccepted` | Must be the literal boolean `true`. Missing consent, `false`, and the string `"true"` are rejected. |

Unknown fields are rejected. The caller cannot choose `role`, `status`, or a user ID during registration. The backend assigns role `USER` and account status `ACTIVE`.

A successful request returns **201 Created** with the public account fields:

```json
{
  "userId": "507f1f77bcf86cd799439011",
  "name": "Travel Tester",
  "email": "travel.tester@example.com",
  "role": "USER",
  "status": "ACTIVE",
  "createdAt": "2026-11-01T10:00:00.000Z",
  "updatedAt": "2026-11-01T10:00:00.000Z"
}
```

The ID and timestamps above are examples. MongoDB stores the document's `_id`; the API exposes it as `userId`. Passwords and password hashes are excluded from the response.

Invalid input returns **400 Bad Request**, with `statusCode: 400`, `error: "Bad Request"`, `message: "Validation failed"`, and an `errors` object mapping field names to nonempty arrays of validation messages. Nested fields use dotted paths, for example `passengers.0.fullName`; empty parent entries and raw request values are omitted. A registered email returns **409 Conflict**:

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "Email is already registered",
  "errors": {
    "email": ["Email is already registered"]
  }
}
```

Email uniqueness applies after normalization, so `Travel.Tester@example.com` and ` travel.tester@example.com ` refer to the same email.

## Login and current identity

`POST /api/auth/login` accepts only:

```json
{
  "email": "travel.tester@example.com",
  "password": "Travel2026"
}
```

Email is trimmed/lowercased; the password is checked exactly as supplied against the existing salted scrypt hash. All four agreed roles can log in. Ordinary success returns **200** with the same public user fields as registration, sets two normal cookies and expires any stale password-change cookie. Temporary-password login instead uses the restricted flow below. Neither token nor any credential/session field appears in JSON. Both successful login and `/api/auth/me` return `Cache-Control: no-store`.

| Cookie | Lifetime and protections |
| --- | --- |
| `__Host-accessToken` | Signed HS256 access JWT; 15 minutes. HttpOnly, Secure, SameSite=Lax, Path=/, no Domain. |
| `__Host-refreshToken` | Random 256-bit opaque token; maximum seven days. The same cookie protections apply; only its SHA-256 hash is stored in the private AuthSession record. |

`GET /api/auth/me` accepts the access cookie and returns **200** with the public identity. It verifies JWT signature/algorithm/issuer/audience/claims/expiry, reloads the current account role/status, and checks the associated session's user, revocation, seven-day absolute expiry and 30-minute inactivity boundary. Successful authenticated checks update activity atomically. MongoDB TTL cleanup is housekeeping; authorization checks expiry directly.

**Token-renewal boundary:** the refresh cookie/storage foundation supports server-side revocation, but `/api/auth/refresh` is not implemented. Neither reviewed ACC-06 nor ACC-19 mandates that endpoint or a rotation policy. There is no automatic renewal: an expired 15-minute access token requires login again. The agreed seven-day session maximum does not override access expiry or 30-minute inactivity. Frontend integration and JavaScript-storage verification belong to Milestone 2.

Ordinary wrong passwords, unknown emails and deactivated accounts receive the same **401** message: `Invalid email or password`; temporary lockout has the explicit message below. Valid suspended-account credentials receive **403**, `Account is suspended`; the status is not disclosed for a wrong password. An unlocked active account requiring a password change receives **200**, `{ "passwordChangeRequired": true }`, with only a restricted credential as described below. Invalid DTO fields receive **400**. Missing/invalid/expired/revoked/inactive or newly ineligible sessions receive **401**, `Invalid or expired session`.

## Failed-login lockout (ACC-05)

The reviewed workbook (`Mandatory!D4`) requires five consecutive failed logins, a 15-minute lock and a lockout message. The same rule applies to all four roles and normalized versions of the same email. It uses the existing private User fields `failedLoginAttempts` and `lockedUntil`; account status remains ACTIVE during a temporary lock, distinct from SUSPENDED.

- Failures one through four return the ordinary **401** credential error and increment the account's streak.
- The fifth failure starts the 15-minute lock and returns **401**, `Account temporarily locked. Try again later.` Further wrong or correct passwords return that lockout message without clearing or extending the active lock. No new cookies/session are issued.
- A successful eligible login before the threshold resets the counter to zero. After a lock expires, a correct password can log in and clear the lock; an incorrect password starts a fresh streak at one. No background unlock job is needed.
- Unknown emails do not create accounts or lock records. Invalid DTOs are rejected before credential handling. Suspension/deactivation restrictions still apply; a required password change never grants unrestricted login.
- Lockout prevents new logins; it does not revoke already issued sessions. Existing authenticated access remains subject to the usual session/account checks. Refresh and logout behavior are unchanged.

MongoDB atomically evaluates the current password hash, account eligibility and lock deadline when incrementing/resetting. Database time (`$$NOW`) sets and checks the deadline. Active locks are excluded from updates; expired locks start a fresh streak. A correct-password request that began earlier cannot clear a lock committed by the concurrent fifth failure. If the successful reset wins first, later failures begin a new streak. The API never includes the stored counter, lock timestamp or password hash as response fields. The required lockout message is intentionally distinct from ordinary generic credential errors.

For a manual Swagger check using an agreed test account: make four wrong-password requests, then a fifth; verify the fifth shows the lockout message and a correct password is also blocked. After 15 minutes, verify a correct password succeeds. Automated tests simulate expiry in their own temporary database and exercise concurrent request ordering, avoiding a real 15-minute wait or shared Atlas changes.

The database implementation follows [MongoDB single-document atomicity](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/) and [update pipelines](https://www.mongodb.com/docs/manual/tutorial/update-documents-with-aggregation-pipeline/). Ordinary credential errors remain generic as described in [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html); the explicit lockout message follows the reviewed ACC-05 requirement.

The approved deployment assumption is a same-origin frontend/API. NestJS CSRF protection rejects browser requests reported as cross-origin on state-changing routes, including login/registration; CORS is not opened. Do not weaken Secure cookies for a LAN HTTP address. Use HTTPS outside local development. Nest documents browser support for Secure cookies on localhost; verify the browser you use. Frontend requests send cookies with the appropriate credentials setting and obtain identity from `/api/auth/me`, not by reading tokens into JavaScript storage.

For manual checks in Swagger, register a distinct agreed test account, call login, then call `/api/auth/me` in the same browser. The browser manages HttpOnly cookies; do not paste tokens into Swagger's authorization field or this log. A Swagger security scheme documents the access cookie but does not make it JavaScript-readable. Confirm unknown/wrong credentials fail, successful JSON contains only public fields, and requests without the cookie are rejected. Shared Atlas checks require agreed test records and cleanup; automated tests use a temporary local database instead.

The implementation uses the official [NestJS cookie guidance](https://docs.nestjs.com/http/cookies), [NestJS CSRF protection](https://docs.nestjs.com/security/csrf), [Nest JWT package](https://github.com/nestjs/jwt) and [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Logout and inactivity (ACC-06)

`POST /api/auth/logout` takes its session credentials from the browser's authentication cookies; no JSON body or user/session ID is required. A successful request returns **204 No Content**, `Cache-Control: no-store`, and expires access, refresh and password-change cookies using the same HttpOnly/Secure/SameSite=Lax/Path=/ settings with no Domain. Cookie settings are shared with login so clearing cannot drift from issuance.

The default action is current-browser logout. The server matches the opaque refresh cookie by its SHA-256 hash, and independently validates access/password-change JWT purposes before using their exact session/user claims. Only matching sessions are revoked; a request cannot select another account through body/query IDs. If cookies identify different valid sessions, the represented sessions are revoked. Other sessions without a presented credential remain intact.

Logout uses the refresh cookie even when access has expired or the account is suspended, deactivated or deleted. Missing/malformed credentials and repeated logout are idempotent: cookies are cleared and the endpoint returns 204 without revealing whether a session existed. Repeating logout preserves the original revocation timestamp and never advances activity or session expiry.

Server revocation completes before cookie clearing. A database error returns the standard generic **500** response and preserves cookies for retry. Revocation is atomic per matching document; a multi-document failure may partially revoke the represented sessions, so a retry completes the monotonic operation. Successful logout does not claim a rollback or require a transaction. Same-origin CSRF checks reject foreign browser writes with **403** before changing session state or cookies.

The guard enforces **30 minutes without an authenticated request**, not a fixed 30-minute lifetime. It checks the idle/absolute deadline and revocation and advances activity atomically using database time (`$$NOW`). A failed/expired/revoked request cannot revive a session; TTL deletion is only housekeeping. After expiry, protected routes return 401 and require a new login. The actual frontend login redirect is Milestone 2; no frontend is required for Milestone 1.

For a manual Swagger check with an agreed test account: log in, call `/api/auth/me`, call logout, then confirm `/api/auth/me` returns 401. Log in again to establish a fresh session. Automated tests additionally prove that replaying the old access cookie fails after server revocation, that the old refresh hash is marked revoked, and that an unrelated login remains valid. Do not paste token values into the log or Swagger authorization fields.

The logout implementation follows [Express cookie-clearing behavior](https://expressjs.com/en/guide/migrating-5/) and [OWASP server-side session invalidation](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html). Current-browser scope and the 204/idempotent/error policy are implementation choices; the reviewed sheet requires cookie clearing, server refresh-token revocation and 30-minute inactivity expiry.

## Temporary passwords and password changes (ACC-07a / ACC-08)

`POST /api/admin/users/:userId/reset-password` requires a normal authenticated ADMIN session. Input is `{ "temporaryPassword": "<compliant temporary password>" }`; the replacement follows the registration policy. Targets must be users or airline/hotel moderators, never administrators. Invalid IDs/input return 400; missing/unsupported targets return 404; non-admin callers receive 403. Success returns 204 with no password or token. The administrator delivers the temporary password outside this API. Reset preserves ACTIVE/SUSPENDED/DEACTIVATED status, clears failed-login lockout and sets the mandatory-change flag. It does not unsuspend or reactivate an account.

At the next eligible login, temporary credentials return only `{ "passwordChangeRequired": true }`. The server clears normal cookies and sets `__Host-passwordChangeToken`: a 15-minute, purpose-bound JWT in an HttpOnly, Secure, SameSite=Lax, Path=/ cookie with no Domain. Its server session is revocable; it has no issued access/refresh pair. It permits password change and logout, never `/api/auth/me`, bookings or admin routes. Normal lockout and account-status rules still apply.

`PATCH /api/auth/change-password` accepts `{ "currentPassword": "<current or temporary password>", "newPassword": "<compliant different password>" }`. Every role can use its own normal access cookie; forced-change users use the restricted cookie. Passwords are preserved exactly, including whitespace/case. Invalid fields/unchanged passwords return 400; an incorrect current password or stale session returns 401. Success returns 204, clears all three cookies and requires fresh login. The caller cannot supply a target user ID or role.

The agreed private `credentialVersion` on User and AuthSession binds a session to the password state verified at login. Reset/change increments the User version in the same atomic write as the new salted hash, flag and counters. Old sessions become unusable even if their records remain until TTL cleanup; this is logical invalidation, not a claim of physical deletion or multi-document rollback. Authentication checks current account state/version before and after its session activity write. Missing stored versions in legacy documents mean zero. Password-change CAS matches the expected hash, version, flag and ACTIVE status, preventing stale concurrent requests from overwriting a newer reset/change.

ACC-18 setup is now provided by the administrator seed command; ACC-14 account listing/search remains a separate Arwa dependency. The reset API accepts a known user ID; tests create administrator fixtures only inside their isolated database. Frontend navigation and real-browser verification remain Milestone 2/manual work. The design follows [OWASP current-password reauthentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) and [recovery/session invalidation guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## Administrator setup (ACC-18)

From an interactive terminal in `backend/`, run `npm.cmd run seed:admin`.
It prompts for name, email, a hidden password, and explicit terms/privacy consent.
The existing registration validation and salted password hashing are reused.
No default credential is committed, printed, or passed in command-line arguments;
no new environment variable is required. The existing root `.env` provides
MONGODB_URI. Setup starts no HTTP server or booking maintenance.

Only a new account is created as ADMIN/ACTIVE. Repeating setup for an existing
administrator preserves every field, including password, suspension, timestamps
and counters. An email belonging to a non-admin fails without promotion. Public
registration still creates USER accounts only; no admin creation API is added.
The command supports `--stdin-json` for controlled automation with the same
name/email/password/termsAccepted fields; keep that input out of shell history,
files and logs. Tests use it with `--no-env-file` and an isolated database.
The interactive prompt was verified in a local PTY with a synthetic account:
password characters were not echoed and setup completed successfully.

Arwa (Person 2) can use the seeded administrator with existing login/ADMIN guards
after this session PR is merged and setup is run. AI has not created a real
administrator or run setup against shared Atlas.

## Profiles and shared currencies (ACC-09)

`GET /api/users/me` returns the current account's public fields plus `phoneNumber` and `preferredCurrency` when set. It never returns another user's profile based on a query/body ID. All four roles use a normal authenticated session; restricted password-change cookies are ineligible. Existing registration, login and `/api/auth/me` response shapes stay unchanged.

`PATCH /api/users/me` accepts any nonempty subset of:

```json
{
  "name": "Alex Traveler",
  "phoneNumber": "+201012345678",
  "preferredCurrency": "EGP"
}
```

Name is trimmed and must remain nonempty. Phone input is trimmed and must have international syntax: + followed by 8–15 digits, starting nonzero; this checks format, not whether the number exists. Currency is trimmed/uppercased and must exist in the shared catalog. Omitted fields remain unchanged; null/blank values, unknown fields, email/role/status/ID changes and empty patches return 400. Every supplied field validates before any update. A successful request returns 200 with the profile, no authentication-cookie changes and `Cache-Control: no-store`. Both GET/PATCH enforce current eligibility and the server-captured credential version; concurrent patches change only their supplied fields.

`GET /api/currencies` is public and returns a sorted array of `{ "code": "EGP", "name": "Egyptian pound" }` entries. The shared MongoDB collection is `currencies`: unique uppercase three-letter `code`, `name`, `_id` and timestamps. Initial codes **AED, EGP, EUR, GBP, JPY, SAR, USD** come from the PDF-linked [Countries.csv reference](https://docs.google.com/spreadsheets/d/1SlKUTRqlHuBJAMC-Z-QOZzSrzKpGHT_TgQUI5gVm-BA/edit?gid=2042930643); readable currency names are maintained in the seed constant. These values form the initial team catalog, while later additions need shared coordination.

For explicit setup from `backend/`, using the existing ignored root `.env`:

```powershell
npm.cmd run seed:currencies
```

This builds and runs only a standalone catalog seed context. It starts no HTTP server, authentication flow or booking maintenance. Upserts insert missing required codes; reruns preserve existing names, IDs, timestamps and additional currencies. It does not delete data. Normal application startup never seeds. Output is a count or sanitized error without the URI/credentials; an isolated test process can pass `--no-env-file` with its own MONGODB_URI. No new application environment variable is needed. Run the reviewed setup against the shared team database once, rather than asking each module to seed a separate list.

Kiki (Person 7) should import `CurrenciesModule` from `src/currencies/currencies.module` and inject its exported `CurrenciesService`. Use `listSupported(): Promise<Currency[]>` and `isSupported(code: string): Promise<boolean>`; the membership method expects the exact uppercase three-letter code. Use the persisted catalog or public endpoint, not a copied enum/list or the seed constant as runtime validation. The profile's preference stays optional. Budget conversion/FXRatesAPI and rate/error handling remain Kiki's module; booking/payment/refund currency remains Hicham's separate PAY-04 policy. Coordinate shared reference-data setup with Gamila (Person 3) when needed.

## Reusing authentication in other modules

Import `AuthModule` into the feature module and apply its exported `AuthGuard` with `@UseGuards(AuthGuard)` to protected controllers/routes. The guard supplies `request.user = { userId, role }` using the current database account; `AuthenticatedRequest` describes the request type. Each module owner must still scope queries to the authenticated user/provider and enforce ownership.

For a role-restricted route, import `RolesGuard` and the `Roles` decorator from `src/auth`, and import `UserRole` from the shared enum. Apply the guards in this order:

```ts
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
```

`AuthGuard` establishes the identity; `RolesGuard` checks that server-established role. Missing identity returns 401; a disallowed role or missing/empty role policy returns 403. Method-level role metadata replaces controller-level metadata. Role claims in request bodies or query strings are ignored. The role guard is exported by `AuthModule` and uses Nest's `Reflector`; it does not require another role enum or dependency. Moderator-provider assignments and resource ownership remain the respective module owner's checks.

## How a request reaches MongoDB

1. `RegisterDto` describes the accepted input. Nest's validation pipeline normalizes the name and email, checks each field, and rejects unknown properties before the request reaches the service.
2. The authentication controller passes the validated input to `AuthService`, which coordinates registration.
3. `PasswordService` uses asynchronous Node.js `scrypt` with a random salt to create the password hash. Plaintext passwords are not stored.
4. `UsersService` saves the account through the Mongoose user model. The database enforces email uniqueness, and Mongoose provides `createdAt` and `updatedAt` timestamps.
5. The service returns the public account fields, and the controller sends the 201 response.

The shared role enum contains `USER`, `ADMIN`, `AIRLINE_MODERATOR`, and `HOTEL_MODERATOR`. The shared account-status enum contains `ACTIVE`, `SUSPENDED`, and `DEACTIVATED`. Other modules should import these shared definitions when needed. Registration always assigns `USER` and `ACTIVE`; privileged account creation is outside ACC-01.

For the framework mechanisms used here, see the official [Nest validation documentation](https://docs.nestjs.com/techniques/validation), [Nest Mongoose integration documentation](https://docs.nestjs.com/techniques/mongodb), and [Node.js 24 scrypt documentation](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).

## Verify the endpoint in Swagger

Start the backend, open Swagger UI, expand `POST /api/auth/register`, and select **Try it out**. These requests create test accounts in the configured database, so use distinct test email addresses.

| Check | Request | Expected result |
| --- | --- | --- |
| Valid registration | Send the sample body with an unused email. | 201; role `USER`, status `ACTIVE`, normalized email, and public account fields. |
| Normalization | Use an unused email with surrounding spaces and uppercase letters, and a name with surrounding spaces. | 201; trimmed name and lowercase, trimmed email. |
| Duplicate email | Repeat a successful email using different capitalization or surrounding spaces. | 409; no second account is created. |
| Invalid email | Set `email` to `not-an-email`. | 400; an email validation message. |
| Short password | Set `password` to `Trip1`. | 400; a password validation message. |
| Missing letter or digit | Try `12345678`, then `abcdefgh`. | 400 for each request. |
| Missing consent | Remove `termsAccepted`, set it to `false`, or use `"true"`. | 400 for each request. |
| Role injection | Add `"role": "ADMIN"` to the sample body. | 400; registration cannot assign privileged roles. |
| Unknown property | Add an extra field such as `"unexpected": true`. | 400; the field is rejected. |

## Flight booking and inventory holds

`backend/src/flight-bookings` implements FLT-19, FLT-21, FLT-22, FLT-23, FLT-25, FLT-26, the booking side of FLT-12, and GEN-11. It is built against the [flight booking contract proposal](../docs/requirements/flight-booking-contract-proposal.md), which lists the fields it needs from other modules and the open team decisions.

| Method | Endpoint | Result |
| --- | --- | --- |
| POST | `/api/flight-bookings` | Validates and prices a booking. Reserves and stores nothing. |
| POST | `/api/flight-bookings/hold` | Reserves seats and creates a `PENDING` booking for 10 minutes. |
| GET | `/api/flight-bookings` | Your bookings; `group=UPCOMING`, `PAST` or `CANCELLED`, page size 10. |
| GET | `/api/flight-bookings/:id` | One of your bookings. |
| GET | `/api/flight-bookings/:id/cancellation-quote` | The refund you would receive. Changes nothing. |
| POST | `/api/flight-bookings/:id/cancel` | Cancels a Confirmed booking and requests its refund. |
| GET | `/api/flight-bookings/:id/e-ticket` | PDF e-ticket for a Confirmed booking. |

All routes need a login. Another user's booking returns **404**. Booking and cancelling need role `USER`. Amounts are integer minor units.

**Overselling** is prevented by one conditional cabin write: `heldSeats` only increases if `totalSeats - bookedSeats - heldSeats` still covers the request. Hold, confirm, cancel and expiry run in MongoDB transactions, so a round trip reserves both cabins or neither. Transactions need a replica set: Atlas always has one, and the tests start one.

**Expiry** runs every minute, as does retrying failed refund requests and completing departed bookings. Payment checks `holdExpiresAt` directly, so a late sweep cannot extend a hold.

**Integration:** `ports/` defines what this module needs from Flights, Payments and Notifications. The inventory adapter already uses the agreed `flights`, `cabininventories`, `airports` and `airlines` collections, so holds return 404 until those contain data. `adapters/pending-integration.adapters.ts` holds temporary Payments and Notifications bindings: until Person 8's module calls `confirmPaidBooking`, a booking can be held but not confirmed outside the automated tests.

## Itineraries, activities and budgeting

`backend/src/itineraries` implements ITN-01, ITN-03, ITN-05, ITN-07, ITN-08, ITN-10, ITN-12, ITN-14, ITN-16, ITN-18, ITN-20, ITN-21, ITN-25 and ITN-26, plus the itinerary parts of ACC-11 and ACC-12. The interfaces it needs from other modules and the open questions are in the [itinerary contract proposal](../docs/requirements/itinerary-contract-proposal.md).

| Method | Endpoint | Who | Result |
| --- | --- | --- | --- |
| POST | `/api/itineraries` | USER | Create. Currency defaults to `preferredCurrency`, else USD. |
| GET | `/api/itineraries` | signed in | Your itineraries, page size 10. |
| GET | `/api/itineraries/:id` | owner, or anyone if public | Full itinerary with days, city stops and transport costs. |
| PATCH / DELETE | `/api/itineraries/:id` | owner | Update (including `visibility`) or delete. |
| POST | `/api/itineraries/:id/days` | owner | Append a day, or insert at `position`. |
| PATCH | `/api/itineraries/:id/days/reorder` | owner | Body `{ "dayIds": [...] }` with every day once. |
| PATCH / DELETE | `/api/itineraries/:id/days/:dayId` | owner | Edit or remove a day. |
| POST | `/api/itineraries/:id/days/:dayId/activities` | owner | Add an activity. |
| PATCH / DELETE | `/api/activities/:id` | owner | Edit or remove an activity. |
| POST | `/api/activities/:id/images` | owner | Multipart field `image`: JPEG, PNG or WebP, at most 5 MB, 5 per activity. |
| GET / DELETE | `/api/activities/:id/images/:imageId` | read: like the itinerary; delete: owner | Download or remove an image. |
| POST | `/api/itineraries/:id/days/:dayId/budgets` | owner | FOOD, ACCOMMODATION, ACTIVITIES or LOCAL_TRANSPORT. |
| PATCH / DELETE | `/api/budgets/:id` | owner | Edit or remove a budget entry. |
| POST | `/api/itineraries/:id/transport-costs` | owner | Intercity transport cost. |
| PATCH / DELETE | `/api/transport-costs/:id` | owner | Edit or remove it. |
| GET | `/api/itineraries/:id/budget-summary?currency=EUR` | like the itinerary | Totals per category, day, city and transport, converted. |
| GET | `/api/itineraries/public/search` | anyone | `q`, `country`, `city`, `minDays`, `maxDays`, `sort`, `page`. |
| GET | `/api/itineraries/public/:id` | anyone | A public itinerary. |
| POST | `/api/itineraries/:id/clone` | USER | Private copy with `clonedFrom` attribution. |
| GET | `/api/itineraries/:id/hotels?dayId=` | like the itinerary | Hotel search for that city stop. |
| GET | `/api/itineraries/:id/flights?dayId=` | like the itinerary | Flight search into that city stop. |

**Dates and numbering.** Days are stored in order; nothing derived is stored. Day N's date is `startDate + (N - 1)`, and consecutive days in the same city form a city stop. Adding, deleting or reordering days, or changing `startDate`, therefore cannot leave numbers, dates, grouping or per-city budgets out of date. Two simultaneous edits of the same itinerary cannot overwrite each other: the second gets 409 and should reload.

**Access (ACC-11, ACC-12).** Private itineraries are visible only to their owner, including to admins; everyone else gets 404. Public itineraries whose author is deactivated or no longer exists are left unchanged in the database but are hidden from search, viewing, budget summary and cloning (404). They are removed before pagination, so totals only count what can be opened. Suspended authors stay visible. Author status comes from the agreed `UsersService.getAccountStatuses(userIds)` interface (an interim adapter with the same signature until it lands); if the lookup fails, the request fails (500) instead of granting access.

**Currency (ITN-18).** Itinerary, budget, transport and summary currencies must be in the shared catalog from `CurrenciesService` (AED, EGP, EUR, GBP, JPY, SAR, USD; `GET /api/currencies`). The summary calls FXRatesAPI from the backend only, caches each base currency's rates for one hour in `exchangerates`, and returns:

- 400 for a currency outside the catalog;
- 422 if the provider has no rate for one of the currencies;
- 200 with `ratesStale: true` if the provider fails but cached rates under 7 days old exist;
- 503 if the provider fails and there is no usable cache.

`FXRATES_API_KEY` is optional (the provider has a keyless tier) and is sent as a bearer header, never in a URL or response.

**Flights and hotels (ITN-25, ITN-26).** The itinerary derives the city and dates and passes them to the Hotels search (HTL-11, HTL-12) and the Flights search (FLT-11, FLT-12, FLT-15). Until those modules exist, these two endpoints return 503.

For a manual Swagger check: log in, create an itinerary, add days in Cairo, Cairo and Luxor, then reorder them and confirm day numbers, dates and `cityGroups` follow. Add budget entries in EGP and USD and call `budget-summary?currency=EUR`. Make the itinerary PUBLIC, log in as a second user, then search for it and clone it.

## Automated tests

From `backend/`, run:

```powershell
npm.cmd test
```

Test files run sequentially to avoid competing local MongoDB startups. The fixtures use isolated local MongoDB databases and generated test-only signing secrets; they never read `.env` or connect to the team's Atlas database. On Windows, the auth helper first checks for an installed MongoDB executable and starts a separate process with a fresh temporary directory; otherwise it downloads/caches a binary. The booking replica-set fixture uses MongoMemoryServer's binary resolution/download cache. Standard test-process binary settings can select an installed binary for both fixtures; these are not application secrets or `.env.example` additions.

Coverage includes registration, credentials, protected cookies, logout/inactivity, lockout, roles, current-password changes, admin resets, restricted login, credential-version invalidation, concurrent/stale operations, validation and Swagger, plus the imported booking suite. HTTP tests explicitly forward Secure cookies; they do not certify real-browser cookie policy. Do not print cookie/token/hash values when diagnosing a failure.
