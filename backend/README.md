# Backend API (Milestone 1)

This NestJS 12 backend implements the Milestone 1 API for every module: accounts and administration, airlines/flights and flight bookings, hotels/rooms and hotel bookings with reviews, Stripe test-mode payments and refunds, itineraries with budgets and exchange rates, the blog, reports/moderation, notifications and audit logs. It uses TypeScript, Mongoose and the team's shared MongoDB Atlas database. The repository [README](../README.md) has the setup checklist (environment, seeding, running, tests). The sections below document individual features in the order they were built; the newest notes are at the end.
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

## Flight creation and cabin inventory

The root AppModule imports FlightsModule, so Swagger and the running backend expose
POST /api/flights (FLT-03) and POST /api/flights/:flightId/cabins (FLT-04).
Both require a valid AIRLINE_MODERATOR session and the moderator's own airline
assignment. Flight creation also requires the assigned airline to be active and
the airports to exist in the official airport catalog. Date-times are entered in
each airport's local time and stored in UTC. Other users cannot add cabins to an
unassigned airline's flight; only future Scheduled flights accept cabin creation.

The flight/cabin unique indexes are initialized before requests are accepted.
Cabin creation is one transaction: a duplicate anywhere in the batch returns 409
and rolls back every cabin in that request, preserving existing inventory.
Concurrent overlapping batches cannot leave a losing batch partially stored.
The same MongoDB replica-set requirement already used for booking holds applies.
Reference annotations use Mongoose Schema.Types.ObjectId, matching the shared
booking adapter's BSON identifiers; field/collection names are unchanged.

The flights.e2e suite imports the actual root AppModule with an isolated test
configuration (no .env), disables only periodic booking maintenance, and verifies
Swagger/routes, guards, ownership, UTC storage, conflicts, rollback and concurrent
batches against its own temporary replica set. This does not certify real search
integration; itinerary Flights/Hotels search adapters remain pending.

## Flight booking and inventory holds

`backend/src/flight-bookings` implements FLT-19, FLT-21, FLT-22, FLT-23, FLT-25, FLT-26, the booking side of FLT-12, and GEN-11. The [flight booking contract](../docs/requirements/flight-booking-contract-proposal.md) lists what it reads from and exports to other modules, the adopted team decisions and the stable `getMine` fields for ITN-27.

| Method | Endpoint | Result |
| --- | --- | --- |
| POST | `/api/flight-bookings` | Validates and prices a booking. Reserves and stores nothing. |
| POST | `/api/flight-bookings/hold` | Reserves seats and creates a `PENDING` booking for 10 minutes. |
| GET | `/api/flight-bookings` | Your bookings; `group=UPCOMING`, `PAST` or `CANCELLED`, page size 10. |
| GET | `/api/flight-bookings/:id` | One of your bookings, with `refund` (`PENDING`, `REFUNDED` or `FAILED`, from Payments) once a refund exists. |
| GET | `/api/flight-bookings/:id/cancellation-quote` | The refund you would receive. Changes nothing. |
| POST | `/api/flight-bookings/:id/cancel` | Cancels a Confirmed booking and requests its refund. |
| GET | `/api/flight-bookings/:id/e-ticket` | PDF e-ticket for a Confirmed booking, including selected seats. |
| GET | `/api/flight-bookings/:id/seat-map` | Own booking: capacity, occupied numbers and own selections. |
| PUT | `/api/flight-bookings/:id/seats` | Replace future-segment selections atomically; `selections: []` clears them. |

All routes need a login and role `USER` (shared `AuthGuard` and `RolesGuard`). Another user's booking returns **404**. Amounts are integer minor units of USD.

**Cancellation deadline (FLT-26):** the refund is quoted inside the cancellation transaction, and the write only matches while the outbound departure is still in the future by database time (`$$NOW`). A slow airline-policy lookup therefore can never commit a cancellation after departure.

**Seat selection (FLT-28):** adults/children may choose free numbered seats1..cabin capacity during an unexpired hold or before a Confirmed flight departs; infants have no seat. Send `{ "selections": [{ "flightId": "...", "passengerId": "...", "seatNumber": 3 }] }`. It is free, owner-only and transactional. A conflict returns409 without losing earlier selections. Confirmation retains seats; expiry and cancellation release them. Cabin capacity cannot shrink below an assigned seat. FLT-27 flight changes use the separate flow below.

**Overselling** is prevented by one conditional cabin write: `heldSeats` only increases if `totalSeats - bookedSeats - heldSeats` still covers the request. Hold, confirm, cancel and expiry run in MongoDB transactions, so a round trip reserves both cabins or neither. Transactions need a replica set: Atlas always has one, and the tests start one.

**Expiry** runs every minute, as does retrying failed refund requests and completing departed bookings. Payment checks `holdExpiresAt` directly, so a late sweep cannot extend a hold.

**Integration:** `ports/` defines what this module needs from Flights, Payments and Notifications. The inventory adapter reads Person 3's `flights`, `cabininventories`, `airports` and `airlines` collections. `BOOKING_PAYMENTS` is bound to Person 8's `BookingPaymentsAdapter` (hold-expiry PaymentIntent cancellation, refunds, refund status), and `BOOKING_NOTIFICATIONS` to Person 2's `NotificationsService` (booking confirmed and cancelled). `test/flight-bookings-integration.e2e.test.ts` runs these real services together, with only Stripe's network calls faked.



**Flight changes (FLT-27):** POST /api/flight-bookings/:id/changes with replacement flightId/cabinId segments for the same airport pairs, cabin classes and leg count. The owner gets a10-minute quote/hold; the original remains Confirmed. Read/accept /api/bookings/flight-change/:changeId/policies (POST accept-policies with accepted:true). Positive differences use POST /api/payments with bookingType:flight-change and bookingId:changeId; signed Stripe success alone applies them. Equal/lower fares use POST /api/flight-booking-changes/:changeId/confirm after acceptance. GET that change URL for status/lower-fare refund; POST its cancel route to abandon a pending proposal. Booking ID/reference and passenger IDs are preserved. Changed-leg seats are cleared; unchanged seats remain.

Changes/booking responses use integer USD minor units; payment/policy amounts use major units. Lower-fare and cancellation refunds span actual original/change receipts and remain retryable on failure. No new env setting. The approved policy-index migration builds the replacement unique index before retiring the exact known legacy one. See the shared flight contract for lifecycle, recovery, compatibility and owner handoffs. This feature is in draft PR103 until reviewed/merged.

## Itineraries, activities and budgeting

`backend/src/itineraries` implements ITN-01, ITN-03, ITN-05, ITN-07, ITN-08, ITN-10, ITN-12, ITN-14, ITN-16, ITN-18, ITN-20, ITN-21, ITN-25 and ITN-26, the optional ITN-27 bonus, plus the itinerary parts of ACC-11 and ACC-12. The interfaces it needs from other modules and the open questions are in the [itinerary contract proposal](../docs/requirements/itinerary-contract-proposal.md).

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
| POST | `/api/activities/:id/images` | owner | Multipart field `image`: JPEG or PNG, at most 5 MB, 5 per activity. |
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
| GET | `/api/itineraries/:id/flights?departureAirportCode=LHR&roundTrip=true` | like the itinerary | Search into the first itinerary city; dates default to first/last day. |

**Dates and numbering.** Days are stored in order; nothing derived is stored. Day N's date is `startDate + (N - 1)`, and consecutive days in the same city form a city stop. Adding, deleting or reordering days, or changing `startDate`, therefore cannot leave numbers, dates, grouping or per-city budgets out of date. Two simultaneous edits of the same itinerary cannot overwrite each other: the second gets 409 and should reload.

**Access (ACC-11, ACC-12).** Private itineraries are visible only to their owner, including to admins; everyone else gets 404. Public itineraries whose author is deactivated or no longer exists are left unchanged in the database but are hidden from search, viewing, budget summary and cloning (404). They are removed before pagination, so totals only count what can be opened. Suspended authors stay visible. Author status comes from the agreed `UsersService.getAccountStatuses(userIds)` interface (bound to the shared UsersService instance); if the lookup fails, the request fails (500) instead of granting access.

**Currency (ITN-18).** Itinerary, budget, transport and summary currencies must be in the shared catalog from `CurrenciesService` (AED, EGP, EUR, GBP, JPY, SAR, USD; `GET /api/currencies`). The summary calls FXRatesAPI from the backend only, caches each base currency's rates once per UTC calendar day in `exchangerates`, and returns:

- 400 for a currency outside the catalog;
- 422 if the provider has no rate for one of the currencies;
- 200 with `ratesStale: true` if the provider fails but a previous cached snapshot exists;
- 503 if the provider fails and there is no usable cache.

`FXRATES_API_KEY` is optional (the provider has a keyless tier) and is sent as a bearer header, never in a URL or response.

**Flights and hotels (ITN-25, ITN-26).** The itinerary derives the city and dates and passes them to the Hotels search (HTL-11, HTL-12) and the Flights search (FLT-11, FLT-12, FLT-15). The hotel search is connected to `HotelsService.search`. The flight search is connected to `FlightsService.searchForItinerary`, which searches every airport of the destination city.

**Linked bookings (ITN-27, optional bonus).** `POST /api/itineraries/:id/bookings` with `{ type, bookingId, dayId }` links one of the owner's own CONFIRMED or COMPLETED bookings to a day; `DELETE /api/itineraries/:id/bookings/:linkedBookingId` unlinks it (the booking itself is untouched). A hotel day must be a night of the stay (check-in ≤ day < check-out); a flight day must be its local departure date. Only the reference is stored: price and status are read live through `HotelBookingsService.getMine` and `FlightBookingsService.getMine`, so a later cancellation shows as CANCELLED and counts 0. In the owner's budget summary, hotels count as ACCOMMODATION on their day and flights add to that day's transport. Links are owner-only (hidden from other viewers, admins included, and never cloned), removed with their day, and limited to 20 per itinerary. Details: [ITN-27 proposal](../docs/requirements/itn-27-linked-bookings-proposal.md).

**Read-only views for the blog (BLG-12, BLG-13).** `ItinerariesService.listPublicByAuthor(authorId, page)` and `getPublicSummary(itineraryId, authorId?)` return public itinerary summaries with the same visibility rules as public search (PUBLIC only, deactivated or missing authors hidden, summary fields only). See the [itinerary contract](../docs/requirements/itinerary-contract-proposal.md).

**Attractions.** An activity's optional `attractionId` must be one of the shared catalog's ids (`GET /api/attractions`, `att-1` to `att-8`), and that attraction must be in the city of the activity's day; otherwise create and update return 400. Changing a day's city is rejected with 400 while one of its activities points at an attraction in the old city. Send `"attractionId": null` in `PATCH /api/activities/{activityId}` to remove an attraction (an empty string is rejected).

**Moderation hooks (GEN-09, GEN-10).** `ItinerariesService.itineraryExists`, `setItineraryHidden` and `adminDeleteItinerary` are for the reports module. Only PUBLIC itineraries can be reported. A hidden itinerary is shown only to its owner (flagged `isHidden`), and only an administrator can unhide it.

For a manual Swagger check: log in, create an itinerary, add days in Cairo, Cairo and London, then reorder them and confirm day numbers, dates and `cityGroups` follow. Add budget entries in EGP and USD and call `budget-summary?currency=EUR`. Make the itinerary PUBLIC, log in as a second user, then search for it and clone it.

## Hotel profiles

`backend/src/hotels` implements HTL-01/HTL-02 (hotel profiles and photos,
GEN-08), HTL-03/HTL-05/HTL-06 (rooms), HTL-04/HTL-05/HTL-06/HTL-08 (room
availability), HTL-09/HTL-10 (policies), HTL-11/HTL-12/HTL-15 (search), and
HTL-22 (moderator reservations connected through ACC-11), per the
[hotel contract proposal](../docs/requirements/hotel-contract-proposal.md).
The reservations endpoint reuses Person 6's HotelBookingsService through
HotelBookingsReservationsAdapter. Assignment checks run before the read query;
the approved response contains rooms[], guestCount and bookingReference, with
existing totals and pagination. This read integration does not implement holds,
payment confirmation, cancellation or account-deactivation eligibility.

| Method | Endpoint | Who | Result |
| --- | --- | --- | --- |
| POST | `/api/hotels` | ADMIN | Create a hotel profile. `city`/`countryCode` are resolved through the shared `ReferenceDataService`, the same catalog Itineraries uses. Commits the hotel and GEN-07 `HOTEL_CREATED` audit entry in the same transaction, using Arwa's existing audit service. |
| GET | `/api/hotels/:id` | anyone | View a hotel. A deactivated hotel (`isActive: false`) returns 404 for everyone except its assigned moderator and admins, so ACC-15 deactivation hides it without revealing its existence. |
| PATCH | `/api/hotels/:id` | assigned HOTEL_MODERATOR | Edit the moderator's own hotel. `:id` must match their `moderatorassignments` record, the same adapter pattern `AirlinesService.getAssignedAirlineId` uses, with `hotelId` in place of `airlineId`. A mismatched or missing assignment returns 404/403 the same way `FlightsService.getOwnedScheduledFlight` hides another airline's flight. |
| POST | `/api/hotels/:id/rooms` | assigned HOTEL_MODERATOR | Add a room (name, capacity, `pricePerNight` in integer minor units) to the moderator's own hotel. |
| PATCH | `/api/hotels/:id/rooms/:roomId` | assigned HOTEL_MODERATOR | Edit a room. 404 if the room does not exist or does not belong to the caller's own hotel. |
| DELETE | `/api/hotels/:id/rooms/:roomId` | assigned HOTEL_MODERATOR | Soft-deactivates the room (`isActive: false`, 204 No Content) rather than removing the document, so a room referenced by a past/eventual booking keeps a valid id. 409 if the room has an active reservation (Osama's `HotelBookingsService.roomHasActiveReservations`: an unexpired hold or a confirmed stay not yet checked out) — the check and the write share one transaction, so a hold cannot be created in between. |
| POST | `/api/hotels/:id/rooms/:roomId/availability` | assigned HOTEL_MODERATOR | Block a `startDate`/`endDate` range (half-open: `endDate` is checkout) for one room. 409 if it overlaps an existing blocked or booked range. |
| PATCH | `/api/hotels/:id/rooms/:roomId/availability` | assigned HOTEL_MODERATOR | Edit a blocked range's dates (`blockedRangeId` + new `startDate`/`endDate`), or unblock it (`blockedRangeId` + `remove: true`). |
| GET | `/api/hotels/:id/availability` | assigned HOTEL_MODERATOR | Every active room's blocked/booked ranges, optionally windowed by `from`/`to`. |
| PUT | `/api/hotels/:id/policies` | assigned HOTEL_MODERATOR | Update `checkInTime`/`checkOutTime` (`HH:mm`), `cancellationTiers`, or both. Tiers are stored sorted by `daysBeforeCheckIn` descending; duplicate thresholds are rejected, the same rule `AirlinesService.updatePoliciesMine` uses for `cancellationTiers`. |
| GET | `/api/hotels/search` | anyone | `city` (resolved through `ReferenceDataService`), optional `countryCode`, `checkIn`/`checkOut`, `guests`, optional `rooms`/`minPrice`/`maxPrice`/`sort`/`page`. Field names match `ItineraryHotelSearch` in `itineraries/ports/travel-search.port.ts` exactly, so Person 7's eventual adapter is a direct pass-through. Only active hotels with at least `rooms` unblocked rooms whose combined capacity (best `rooms` by capacity) covers `guests` are returned, page size 10. Exact room assignment stays a booking-time concern. |
| GET | `/api/hotels/:id/rooms/available` | anyone | `checkIn`/`checkOut`, optional `guests`. Individual rooms (not a hotel-level summary) with no blocked/booked overlap for the stay and (if `guests` given) enough capacity, cheapest first. |
| GET | `/api/hotels/:id/reservations` | assigned HOTEL_MODERATOR | Ownership is checked before the real HotelBookingsService query (404/403 for another/missing assignment). Returns guest name when available, rooms[], guestCount, bookingReference, dates, status and frozen totalAmount in minor units; ten per page. Payment/policy/private profile details are excluded. |
| POST | `/api/hotels/:id/photos` | assigned HOTEL_MODERATOR | Add a photo (multipart field `photo`): JPG or PNG decided by the file's own bytes via the shared `detectImageExtension` (`common/files/image-type.ts`, the same sniffer airlines' logo upload uses), at most 5 MB, at most 5 per hotel. Returns the hotel with its photo URLs. |
| GET | `/api/hotels/:id/photos/:photoId` | anyone | Photo bytes. Same visibility as the hotel itself: 404 if the hotel is deactivated, except to its own moderator or an admin. |
| DELETE | `/api/hotels/:id/photos/:photoId` | assigned HOTEL_MODERATOR | Removes one photo from the moderator's own hotel. |

Both search endpoints use the same half-open overlap check as `RoomAvailability`: a block/booking ending on a date does not conflict with a stay starting that same date.

Photos are stored as binary documents in their own `hotelphotos` collection (kept out of the hotel document, same pattern as blog post images and itinerary activity images), not on disk — unlike the airline logo upload, which is one file per airline on the filesystem. A hotel needed up to 5 photos, so the multi-document Mongo pattern fit better; only the byte-sniffing helper is shared with airlines.

New hotels default to `isActive: true`, `checkInTime: '14:00'`, `checkOutTime: '11:00'` and no cancellation tiers. Changing `city` re-resolves the country from the reference catalog from scratch; changing only `countryCode` re-resolves against the existing city. Rooms carry no inventory count of their own (HTL-03 "individually bookable rooms"); each room's `RoomAvailability` document instead holds `blockedRanges` (written here) and `bookedRanges` (reserved for the not-yet-built hotel-bookings module — see the contract's section 3 for the overlap-array design and why a hold is a single conditional write).

For a manual Swagger check: log in as the seeded administrator, create a hotel with `city: "Cairo"`, confirm `GET /api/hotels/:id` is public, then log in as a hotel moderator with a matching `moderatorassignments` row, add a room with `POST /api/hotels/:id/rooms`, block a date range with `POST .../availability`, confirm a second overlapping block is rejected (409) while a touching one (same checkout date as the next check-in) is accepted, and confirm `GET /api/hotels/:id/availability` lists it.

## Automated tests

From `backend/`, run:

```powershell
npm.cmd test
```

Test files run sequentially to avoid competing local MongoDB startups. The fixtures use isolated local MongoDB databases and generated test-only signing secrets; they never read `.env` or connect to the team's Atlas database. On Windows, the auth helper first checks for an installed MongoDB executable and starts a separate process with a fresh temporary directory; otherwise it downloads/caches a binary. The booking replica-set fixture uses MongoMemoryServer's binary resolution/download cache. Standard test-process binary settings can select an installed binary for both fixtures; these are not application secrets or `.env.example` additions.

Coverage includes registration, credentials, protected cookies, logout/inactivity, lockout, roles, current-password changes, admin resets, restricted login, credential-version invalidation, concurrent/stale operations, validation and Swagger, plus the imported booking suite. HTTP tests explicitly forward Secure cookies; they do not certify real-browser cookie policy. Do not print cookie/token/hash values when diagnosing a failure.

## Corrected itinerary integration and reference setup (2026-11-06)

From backend run `npm.cmd run seed:references` after review to initialize the official eight countries, eight cities and eight attractions. The command reads the root ignored `.env`, starts no HTTP server or booking maintenance, and preserves existing rows, document IDs and timestamps on repeat runs. Application startup initializes indexes but does not seed the catalog. `GET /api/countries`, `/api/cities` and `/api/attractions` return the canonical records; reuse `ReferenceDataModule` / `ReferenceDataService` instead of private catalogs. Implementation tests use isolated local MongoDB, not Atlas.

For Person 7 (Kiki): import `ReferenceDataModule` into the consuming module and inject `ReferenceDataService`. Call `await references.findAttraction(attractionId)`: it returns the official seeded attraction or `null` for an unknown/unseeded ID. Fields are `attractionId`, `name`, `cityId`, plus internal `_id` and timestamps; the public list returns only the first three. Preserve original IDs `att-1` through `att-8` and city IDs (including `new_york`); do not use MongoDB `_id` as `Activity.attractionId`. Kiki owns activity validation and should reject unknown references with 400 in both `addActivity` and `updateActivity` after this catalog PR is merged and the shared database is seeded. `ItinerariesService` already injects the shared service as `references`; reuse that instance. Existing activity records are not rewritten by this change. The source is `Attractions.csv` in the same official workbook linked in `reference-seeds.ts`, mapping `attraction_id` / `city_id` to the agreed camelCase names.

Itinerary titles are limited to 100 characters and itineraries to 60 days. Countries/cities must be in the official catalog and days must belong to selected countries. Activity cost/currency are optional, with non-negative two-decimal cost; they contribute to Activities totals and survive cloning. Transport creation requires an owned dayId; deleting that day removes its transport entries. Day/city totals include transport without adding it twice to the grand total. Legacy unlinked transport rows are preserved; updating an unlinked entry requires an explicit owned dayId. Parent reads/edits continue to work without a destructive migration.

UsersService.getAccountStatuses and getDisplayNames replace the temporary itinerary status/name adapters. Both are internal projected lookups; no public account directory is added. Public visibility fails closed; proven owner responses do not repeat the owner status lookup.

Budget summary uses the signed-in user's current preferred currency unless overridden; guests use itinerary currency. Rates refresh daily; outages use the last cached rates with their date and stale flag. JPG/PNG are the supported image formats.

ITN-25 hotel criteria now include guests and rooms. ITN-26 takes departureAirportCode and optional roundTrip/departureDate/returnDate, resolving destination airports from the first itinerary city, with default outbound/return dates from the itinerary. The hotel adapter now calls HotelsService.search; the flight adapter calls FlightsService.searchForItinerary (Gamila's multi-airport search). The full corrected contracts are in docs/requirements/itinerary-contract-proposal.md; coordinate their port mappings with Gamila and Lama.


## ACC-11 booking access

GET `/api/flights/:flightId/bookings` reuses FlightBookingsService.listBookingsForFlight after checking the authenticated AIRLINE_MODERATOR's assigned airline. Returns safe booking references, passenger names, cabin, seat count and status, ten per page. Reads are available for past/cancelled flights without changing flight status. Passport/document numbers, birth dates and payment details are excluded. Remaining seats per category and CSV export are still separate FLT-29 work.

Both provider routes use the shared cookie AuthGuard and RolesGuard, authoritative ModeratorAssignment records, validated pagination and Cache-Control: no-store. Ordinary users keep their own /api/flight-bookings and /api/hotel-bookings views. Admins inspect bookings through /api/admin/bookings?type=FLIGHT or type=hotel. Private itineraries remain owner-only, including against admins/moderators. Cross-module regressions are in test/acc11-booking-access.e2e.test.ts.


## ACC-07 bonus: forgotten-password recovery

POST /api/auth/forgot-password with {"email":"your-test-inbox-address"} returns202 and the same generic message for eligible, unknown, inactive and silently rate-limited emails. Account lookup and delivery run asynchronously; the response does not confirm account existence or delivery. POST /api/auth/reset-password with {"token":"token-from-email-fragment","newPassword":"a-new-compliant-password"} returns204 on success. Both routes are public with the existing same-origin write protection and no-store headers. Swagger documents validation, expiry and error responses.

Only the latest accepted link works; it expires30minutes after the request and is single-use. Password replacement uses the shared registration policy/hasher and atomically consumes the proof with its credentialVersion update. Old normal/restricted sessions stop working, cookies are cleared, and a fresh login is required. Password requests do not unlock/suspend/reactivate/promote accounts.

For a manual M1 development-inbox check:

1. Create/use a development SMTP test inbox and an application account using an address you control in that test setup.
2. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM locally in the ignored root .env. Configure all five together. Typical ports are587 (required STARTTLS) or465 (implicit TLS). Do not use your Atlas database credentials for SMTP.
3. Set PASSWORD_RESET_URL to the trusted reset-page URL. HTTPS is required except loopback HTTP for local development. The backend does not implement the M2 page. For an M1 API demo, read the link from the test inbox and copy only its #token=... value into the reset-password JSON body in Swagger.
4. Restart the backend, request a reset, inspect the development inbox, submit a compliant new password and log in again. Verify old password/session and reused/older links are rejected. Never paste real reset links/passwords into chats, GitHub or workflow logs.

All SMTP values and PASSWORD_RESET_URL may be blank to leave recovery disabled; existing mandatory auth still runs. Recovery request then returns503 uniformly. No raw token or delivery status is returned by the API. Request limits:20/IP and5/email per15minutes (silently202); reset attempts20/IP per15minutes (then429). Private TTL records contain hashes/HMAC keys, not plaintext email/IP/token. Queue capacity is bounded; delivery is in-process, not durable across restart. Retry with a new request after an interrupted delivery.

MailModule exports MailService for coordinated reuse; ACC-02 verification is documented below; GEN-01-B notification emails and ACC-12 account deactivation remain separate features. The shared response/naming decisions are recorded in the authentication contract and docs/work-logs/16003651.md.


## ITN-28 bonus: printable itinerary PDF

GET /api/itineraries/:itineraryId/pdf downloads an A4 PDF for a logged-in user. Private itineraries remain owner-only, including against admins/moderators; public export follows the existing readable-itinerary and deactivated-author rules. The separate ItineraryExportsModule reuses ItinerariesService.getReadable without editing the itinerary owner's module.

The printable document includes attribution, derived dates/day order, activities, recorded budget entries and intercity transport. Amounts retain their original currencies; this export does not recalculate FX or confirm bookings. Photos are referenced by count rather than fetched or embedded. No external image/URL request is made. Cache-Control is no-store and the download filename uses only the validated itineraryId.

Keep backend/assets/fonts with the deployed backend. The bundled Noto Latin/Arabic fonts use the included SIL Open Font License; no system-font installation or runtime download is required. Tests cover actual PDF bytes/headers, owner/public/privacy rules, missing/invalid IDs and unchanged stored data. A synthetic two-page sample was rendered and inspected for font alignment, page breaks and footer placement. Frontend download/print controls remain M2.


## ACC-02 bonus: account email verification

The backend sends a verification email after successful registration when SMTP and EMAIL_VERIFICATION_URL are configured. Registered users can request a replacement link through POST /api/auth/resend-verification. GET /api/auth/email-verification returns only the current session owner's emailVerified and requiredForBooking booleans. POST /api/auth/verify-email accepts {"token":"<64 hex characters from the email fragment>"} and returns204 after success. It is proof-only: no automatic login and no password, role, status or credential-version changes.

Proofs are random256-bit tokens, stored only as hashes, bound to the current email/account, expire after24hours, are single-use, and are superseded by a newer accepted request. Verification and password-reset proofs have separate collections/purposes. Shared mail has bounded workers/capacity; delivery failures do not undo successful registration, and the user can resend. Accepted mail is not a durable outbox: a process interruption may require a new request. Request limits are20/IP and5/account per15minutes; proof attempts are20/IP per15minutes. No raw proof, private verification timestamp or SMTP delivery detail is returned by account APIs.

Activation uses the already agreed local settings:

1. Configure the existing SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM together for a development test inbox. Keep credentials in the ignored root .env.
2. Set EMAIL_VERIFICATION_URL to the trusted verification-page URL. Use HTTPS except loopback HTTP locally; no embedded credentials, query or fragment. The email appends #token=...; the M2 client submits that token in the POST body. During M1, submit it yourself in Swagger without sharing the proof or inbox credentials.
3. Leave EMAIL_VERIFICATION_REQUIRED=false until setup is ready. Set it to true and restart to enforce verification; startup fails clearly if required SMTP/URL settings are missing. This implementation does not read/change your private .env or enable the flag automatically.
4. With enforcement on, test an unverified login followed by flight/hotel hold or payment create/retry:403 and no new booking/payment/inventory side effect. Verify the emailed proof, repeat with the same valid cookie, and check success. Used/expired/superseded proofs must fail400.

All existing accounts lacking a verification timestamp remain unverified; no seeded account is silently grandfathered. Login, profile/favourites access, and permitted existing booking/refund reads/cancellation retain their own authorization rules. Existing confirmed bookings are not retroactively invalidated. Future email-change code must atomically clear emailVerifiedAt and invalidate old proofs; there is currently no public email-change endpoint.

The shared EmailEligibilityService is exported from AuthModule. Flight holds and pending-booking confirmation check it inside the booking transaction; hotel creation checks before preparation and inside the hold transaction. Payment create/retry checks it before external side effects, and late success for an ineligible pending hold uses the existing automatic full-refund handling. Lookup failures remain retryable errors, not a false reason to refund. The already-confirmed replay path is preserved. The limited integrations in Ismail's, Osama's and Hicham's services were approved by Malak on2026-11-09; their domain algorithms are unchanged. Hotel paid confirmation now calls the same session-aware policy before HELD-to-BOOKED writes; the generic payment confirmation gate already covers both booking types.

Automated tests use controlled mail/Stripe gateways, real webhook signature checks and isolated local MongoDB. Actual inbox delivery and a deployed M2 verification page are separate setup/client checks, not certified by these tests. No new PDF is committed or generated for this feature.

## Hotel checkout readiness after PR62

Hotel payment creation and retries return503 while the real HotelBookingsService is missing either callable confirmPaidBooking or markPaymentFailed. The internal payments-only checkoutReady flag is derived by BookingsAdapter; it is not a stored booking field, client input or new environment setting. Policy viewing/acceptance, payment history, signed webhooks and compensation/refunds do not use this checkout gate. It does not cancel or repair existing reservations or certify the full hotel lifecycle.

The approved HTL-17 confirmation implementation now supplies both methods, so the real adapter allows checkout. The separate hotel-bookings-confirmation suite exercises real holds, room conversion and payment webhooks without replacing those methods. Earlier simulated hotel cases remain contract coverage. Readiness tests explicitly set the methods unavailable to test the fallback after a connection failure.

## HTL-17: verified hotel confirmation

The internal HotelBookingsService.confirmPaidBooking callback reads the existing Payment schema and requires a SUCCEEDED hotel payment with the matching reservation, owner, amount (converted to minor units) and currency. No client confirmation endpoint is added. In one transaction it checks a PENDING unexpired hold, ACTIVE USER, email eligibility, active hotel/rooms and intact room holds with no new blocked overlap, converts every HELD range to BOOKED, removes hold expiries and saves a unique HTL- reference/paymentId. Any failed room condition aborts the whole conversion. Unexpected persistence/eligibility lookup errors propagate for webhook retry; a booking conflict follows Payments' existing compensation path.

Same-payment confirmed/completed replay preserves history and does not duplicate inventory or notification. markPaymentFailed intentionally leaves the reservation PENDING, allowing payment retry until expiry. A confirmation notification includes the reference, hotel, stay dates, room count and paid total after commit; delivery failure is logged and does not undo payment/booking. Notification is best effort, matching existing flight behavior, not a durable outbox guarantee.

Remaining separate work: M2 confirmation page; provider-admission ordering outside the approved account gate. The approved ACC-12 account gate below serializes account deactivation against both confirmations; provider/room admission ordering remains a separate integration. No new shared schema/enum/environment variable was introduced by this confirmation change.
## HTL-18: expiry payment cancellation and recovery

After committing EXPIRED status and releasing all HELD room ranges, the hotel sweep uses the existing BookingPaymentsAdapter to cancel the payment. No Stripe call runs inside the inventory transaction. It also finds unresolved PENDING/FAILED hotel payments and SUCCEEDED payments without a finished confirmation/refund whose booking is already EXPIRED, so a later sweep or process restart retries cancellations interrupted after commit. Candidates are selected from the payment/booking join before the 100-item batch limit. Successful cancellation uses Payments' existing FAILED/hold-expired reason as its completion marker; no new shared fields are needed. A payment already collected follows the existing automatic-refund path. If that refund fails after Payment becomes SUCCEEDED, the next sweep resumes compensation through the same payment adapter. Failures are logged without undoing room release or preventing other candidates from being processed. Existing payment reads/webhooks/refund recovery remain authoritative.
## HTL-21: user cancellation and refund status

GET /api/hotel-bookings/:id/cancellation-quote previews the owner's Confirmed reservation before its UTC check-in date. It uses the policy snapshot accepted at booking time and the full frozen total, with the shared flight tier-selection/rounding helpers mapped to hotel thresholds. The response includes refundAmount in minor units, percentage, daysBeforeCheckIn, currency, expiresAt and an opaque quoteToken. Preview changes no reservation, inventory or money.

POST /api/hotel-bookings/:id/cancel requires {"confirmed":true,"quoteToken":"<quote token>"}. Tokens last five minutes, use a purpose-bound HMAC with existing JWT_SECRET, and bind owner/reservation, booking version, snapshot policy, full total/currency and UTC quote date. Changed/expired quotes require a fresh preview. No token collection or new environment setting is needed. Client refund amounts, room selection and unknown fields are rejected; cancellation always covers every room. The transaction rechecks quote/deadline and releases only that reservation's BOOKED ranges before recording CANCELLED, USER, cancelledAt, refundAmount and refundDue. It also waits until verified payment confirmation is finalized, avoiding cancellation against an unfinished confirmation callback. A delayed duplicate success handler rereads durable payment outcome markers before automatic compensation, preserving the later cancellation's quoted refund.

After commit the existing BookingPaymentsAdapter requests any positive refund in minor units. Zero refunds make no Stripe call. Unaccepted/uncertain requests leave refundDue for the one-minute maintenance retry; accepted requests use the existing idempotent booking/reason mapping, including lost-response recovery. Detail/cancellation responses expose the current authoritative refundStatus (PENDING, REFUNDED, FAILED) and refundId through the existing payment reader. A terminal FAILED refund is reported, not automatically reissued indefinitely. A best-effort cancellation notification runs after commit; notification failures do not undo cancellation or money operations.

This is the M1 backend flow, not a new client cancellation screen. Provider-initiated hotel cancellation and deferred real SMTP/Stripe demonstrations are separate checks; the approved ACC-12 account gate is described below. No claim of guaranteed notification delivery or atomicity across MongoDB and Stripe is made; persisted recovery flags and idempotency handle the external boundary.
## ACC-12: own-account deactivation

POST /api/users/me/deactivate requires a normal USER session and {"confirmed":true}. Returns204 and expires all auth cookies after committing DEACTIVATED status, a credential-epoch increment, session revocation and removal of bound auth proofs. The account/password/profile/history are retained. Invalid/expired/restricted sessions401; other roles/cross-origin403; invalid/unknown body fields400; upcoming Confirmed bookings409; dependency failures500 with no committed deactivation or cookie clearing.

The approved private User.bookingVersion counter coordinates NEW flight/hotel confirmation and deactivation inside their database transactions. Confirmation first blocks deactivation; deactivation first makes new confirmation fail and late payment use the existing refund path. Future return flights and ongoing hotel stays block deactivation; pending/cancelled/expired/past bookings do not. Missing legacy bookingVersion is0 and corrupt/exhausted values fail closed. No migration/seed or new env setting is required. Booking operations do not increment credentialVersion or invalidate sessions.

Public posts/itineraries hide their deactivated author; comments/reviews retain content with Deleted user attribution through the existing shared readers. This endpoint does not hard-delete data, implement account reactivation or add an M2 page. See the shared authentication contract and work log for integration/testing evidence. Both booking eligibility reads accept an optional ClientSession, preserving existing callers.

### Administrator action/audit consistency

Admin temporary-password resets record PASSWORD_RESET with the authenticated admin and target IDs. Credentials and audit commit together; failed persistence returns the generic500 without changing the target password or invalidating old sessions. Passwords/hashes are never copied into audit details. Account/provider status changes commit their audit and stored inbox entries in the same MongoDB transaction; moderator creation also commits its audit with the account/assignment. A failed required write rolls back the action so retry is safe. Hotel and airline creation also commit the provider and its HOTEL_CREATED/AIRLINE_CREATED audit together. A failure before or after the audit insert rolls back both records, so retry does not leave a provider from the failed request. Duplicate airline codes still return409. These transactions require a replica set (Atlas or the isolated test replica set).

Hotel deactivation invokes the existing pending-hold cleanup after commit and preserves confirmed stays. If cleanup fails, the provider remains deactivated and normal hold expiry provides fallback. Full concurrent provider/room deactivation ordering remains a separate integration task.

### BON-01 admin analytics backend

`GET /api/admin/analytics?from=2026-11-01&to=2026-11-20&type=hotel&page=1` requires an active ADMIN session. `type` is optional (`airline`/`hotel`); dates are inclusive UTC dates with a maximum 366-day span. Results contain ten providers per page, sorted by net receipts, with `bookings`, `grossRevenueMinor`, `refundedMinor`, `netRevenueMinor`, `currency`, provider ID/name and an explicit report basis. All money is USD cents.

The period selects successful booking confirmations (`Payment.bookingConfirmedAt`), including later-cancelled/completed history. Unpaid holds, failed payments and late-success compensation without a confirmed booking are excluded. Completed refunds against each original receipt are included through report generation, even if they occurred after the selected confirmation period; failed/pending and extra-payment-compensation refunds are excluded. This is a confirmation-cohort receipts report, not cash movement by refund date or a provider payout ledger. A booking involving multiple airlines counts once per participating airline, so counts across airlines are not additive. Gross flight receipts are allocated by stored segment fare weights; refunds use those allocated gross weights. Largest-remainder cent allocation preserves totals and keeps gross attribution stable; all-zero fares use equal provider weights.

The module reads existing schemas in one MongoDB snapshot and never mutates bookings, inventory, payments, refunds or provider records, and never calls Stripe. Missing/inconsistent financial references fail instead of returning partial totals. Passenger details, user IDs, payment-intent IDs and secrets are not included. The M2 visual dashboard is not implemented by this API. No new environment setting or collection is required.


## GEN-01-B: notification emails and moderator invitations

The existing GEN-01 notification producers now queue an SMTP copy automatically. `NotificationsService.notify/notifyMany` retain their interfaces and store the in-app notification plus a private email job in one transaction (joining the caller's transaction when supplied). Admin moderator creation queues an invitation in the existing account/assignment/audit transaction. A rolled-back action cannot produce an email. SMTP failure after commit does not undo a booking, account or inbox entry.

Reuse the existing `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` in the ignored root `.env`. No new environment variable or public endpoint is needed. With SMTP unset, new jobs remain pending and the in-app inbox works; configure SMTP and restart to deliver them. Older notifications are not backfilled.

Each API process checks the private `notificationemailjobs` collection every 15 seconds and claims one job per tick, avoiding SMTP bursts in the development sandbox. Mailtrap documents [short-window sandbox rate limits](https://docs.mailtrap.io/email-sandbox/help/features-and-limits). Atomic claims use two-minute leases and fencing tokens so another worker does not normally deliver the same job. Failed sends retry up to five attempts with 30/60/120/240-second backoff; exhausted jobs stay FAILED for operator review. Expired leases are recoverable after restart. The outbox deduplicates each notification and each moderator-account invitation.

Delivery is **at least once**: a crash after SMTP accepts a message but before SENT is recorded can cause a duplicate. SENT means SMTP acceptance, not proof that a recipient read the message. SMTP diagnostics/recipient/message contents are not logged. Jobs contain no passwords, password hashes, reset tokens or SMTP credentials. Moderator invitations tell the moderator to obtain the admin-set temporary password separately and change it at first login.

Development checks: use Mailtrap Email Sandbox, create a moderator as an authenticated admin, and inspect its invitation after a worker tick. New booking/refund/status/schedule notices use the same path as their existing in-app notifications. Keep temporary passwords private. `notification-emails.e2e.test.ts` uses isolated MongoDB and a fake transport for rollback, pending setup, retry, lease and invitation tests; other domain suites cover the existing notification producers. No email job/recipient/retry state is exposed by the inbox API.

## PDF endpoint paths and audit fixes (2026-11-11)

Every endpoint in the project description's section 8 tables now exists at its PDF path; `test/pdf-api-coverage.e2e.test.ts` checks this against Swagger. Where a route already existed under another path, the PDF path calls the same service. No business logic is copied, and the original paths keep working:

| PDF path | Same as |
| --- | --- |
| `DELETE /api/users/me` (body `{ "confirmed": true }`) | `POST /api/users/me/deactivate` (ACC-12; the account is deactivated, not erased) |
| `PATCH /api/airlines/:id` | `PATCH /api/airlines/me` (FLT-01); `:id` must be the moderator's own airline, otherwise 404 |
| `PUT /api/airlines/:id/baggage-policy` | baggage part of `PATCH /api/airlines/me/policies` (FLT-08) |
| `PUT /api/airlines/:id/cancellation-policy` | tier part of `PATCH /api/airlines/me/policies` (FLT-09) |
| `GET /api/flights/:id/passengers/export` | `GET /api/flights/:id/bookings/export.csv` (FLT-29) |
| `PATCH /api/flight-bookings/:id/change-flight` | `POST /api/flight-bookings/:id/changes` (FLT-27 bonus) |
| `PATCH /api/flight-bookings/:id/seat` | `PUT /api/flight-bookings/:id/seats` (FLT-28 bonus) |
| `PATCH /api/posts/:id/itinerary` (body `{ "itineraryId": "..." }` or `null`) | `itineraryId` in `PATCH /api/posts/:id` (BLG-13 bonus) |

The optional ACC-02 `GET /api/auth/verify-email` is deliberately `POST /api/auth/verify-email`: the single-use token travels in the JSON body rather than a URL, where it could leak into logs and browser history.

Behaviour fixed in the same audit:

- **GEN-02:** an empty `PATCH` of a flight, cabin or airline profile is a 400 validation error. It used to return 200 without changing anything: with this TypeScript target, every declared optional DTO field exists as an `undefined` key, so `Object.keys()` was never empty. `common/validation/defined-fields.ts` checks for supplied values instead.
- **HTL-02:** `GET /api/hotels/:id` adds `reviews` (newest first, first page of 10) next to `averageRating`/`ratingCount`. With `checkIn` and `checkOut` (and optional `guests`) it also returns `availableRooms` for that stay; without dates, `availableRooms` is null. Only one date is a 400.
- **HTL-06:** `DELETE /api/hotels/:id/rooms/:roomId` permanently deletes a room only if no reservation of any status ever referenced it; otherwise it returns 409. `PATCH /api/hotels/:id/rooms/:roomId` with `{ "isActive": false }` deactivates a room (409 while it has a Confirmed or unexpired Pending Payment reservation) and `{ "isActive": true }` reactivates it. Deletion takes the room's booking gate, so it cannot race a new hold.
- **FLT-05:** `PATCH /api/flights/:id` accepts `departureAirportCode`/`arrivalAirportCode` while the flight has no booking and no flight-change hold. The check and the write share one transaction with the flight's booking gate; once any booking exists, it returns 409.
- **FLT-11/FLT-12:** flight search accepts a same-day round trip (`returnDate` equal to `departureDate`); only return flights that leave after the outbound lands are offered. Impossible dates such as `2027-02-30` are rejected with 400.
- The flight-cancellation response and the Swagger description no longer describe integrations as missing.

