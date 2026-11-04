# Backend: registration and login

This NestJS 12 backend implements ACC-01 registration, ACC-04 login, ACC-05 failed-login lockout and ACC-06 logout/inactivity using TypeScript, Mongoose and MongoDB Atlas. Registration creates a normal account without logging it in. Login issues protected cookies; `/api/auth/me` returns the current public identity through a reusable authentication guard. Profile/password-management features and optional token renewal are later work.

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

Invalid input returns **400 Bad Request**, with `statusCode: 400`, `error: "Bad Request"`, `message: "Validation failed"`, and an `errors` object mapping field names to arrays of validation messages. A registered email returns **409 Conflict**:

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

Email is trimmed/lowercased; the password is checked exactly as supplied against the existing salted scrypt hash. All four agreed roles can log in. Success returns **200** with the same public user fields as registration, and sets two cookies. Neither token nor any credential/session field appears in JSON. Both successful login and `/api/auth/me` return `Cache-Control: no-store`.

| Cookie | Lifetime and protections |
| --- | --- |
| `__Host-accessToken` | Signed HS256 access JWT; 15 minutes. HttpOnly, Secure, SameSite=Lax, Path=/, no Domain. |
| `__Host-refreshToken` | Random 256-bit opaque token; maximum seven days. The same cookie protections apply; only its SHA-256 hash is stored in the private AuthSession record. |

`GET /api/auth/me` accepts the access cookie and returns **200** with the public identity. It verifies JWT signature/algorithm/issuer/audience/claims/expiry, reloads the current account role/status, and checks the associated session's user, revocation, seven-day absolute expiry and 30-minute inactivity boundary. Successful authenticated checks update activity atomically. MongoDB TTL cleanup is housekeeping; authorization checks expiry directly.

**Token-renewal boundary:** the refresh cookie/storage foundation supports server-side revocation, but `/api/auth/refresh` is not implemented. Neither reviewed ACC-06 nor ACC-19 mandates that endpoint or a rotation policy. There is no automatic renewal: an expired 15-minute access token requires login again. The agreed seven-day session maximum does not override access expiry or 30-minute inactivity. Frontend integration and JavaScript-storage verification belong to Milestone 2.

Ordinary wrong passwords, unknown emails and deactivated accounts receive the same **401** message: `Invalid email or password`; temporary lockout has the explicit message below. Valid suspended-account credentials receive **403**, `Account is suspended`; the status is not disclosed for a wrong password. An unlocked account requiring a password change receives **403**, `Password change is required`, and no unrestricted session while that future flow is absent. Invalid DTO fields receive **400**. Missing/invalid/expired/revoked/inactive or newly ineligible sessions receive **401**, `Invalid or expired session`.

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

`POST /api/auth/logout` takes its session credentials from the browser's authentication cookies; no JSON body or user/session ID is required. A successful request returns **204 No Content**, `Cache-Control: no-store`, and expires both cookies using the same HttpOnly/Secure/SameSite=Lax/Path=/ settings with no Domain. Cookie settings are shared with login so clearing cannot drift from issuance.

The default action is current-browser logout. The server matches the opaque refresh cookie by its SHA-256 hash, and independently validates the access JWT before using its exact session/user claims. Only matching sessions are revoked; a request cannot select another account through body/query IDs. If the two cookies identify different valid sessions, both represented sessions are revoked. Other sessions without a presented credential remain intact.

Logout uses the refresh cookie even when access has expired or the account is suspended, deactivated or deleted. Missing/malformed credentials and repeated logout are idempotent: cookies are cleared and the endpoint returns 204 without revealing whether a session existed. Repeating logout preserves the original revocation timestamp and never advances activity or session expiry.

Server revocation completes before cookie clearing. A database error returns the standard generic **500** response and preserves cookies for retry. Revocation is atomic per matching document; a multi-document failure may partially revoke the represented sessions, so a retry completes the monotonic operation. Successful logout does not claim a rollback or require a transaction. Same-origin CSRF checks reject foreign browser writes with **403** before changing session state or cookies.

The guard enforces **30 minutes without an authenticated request**, not a fixed 30-minute lifetime. It checks the idle/absolute deadline and revocation and advances activity atomically using database time (`$$NOW`). A failed/expired/revoked request cannot revive a session; TTL deletion is only housekeeping. After expiry, protected routes return 401 and require a new login. The actual frontend login redirect is Milestone 2; no frontend is required for Milestone 1.

For a manual Swagger check with an agreed test account: log in, call `/api/auth/me`, call logout, then confirm `/api/auth/me` returns 401. Log in again to establish a fresh session. Automated tests additionally prove that replaying the old access cookie fails after server revocation, that the old refresh hash is marked revoked, and that an unrelated login remains valid. Do not paste token values into the log or Swagger authorization fields.

The logout implementation follows [Express cookie-clearing behavior](https://expressjs.com/en/guide/migrating-5/) and [OWASP server-side session invalidation](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html). Current-browser scope and the 204/idempotent/error policy are implementation choices; the reviewed sheet requires cookie clearing, server refresh-token revocation and 30-minute inactivity expiry.

## Reusing authentication in other modules

Import `AuthModule` into the feature module and apply its exported `AuthGuard` with `@UseGuards(AuthGuard)` to protected controllers/routes. The guard supplies `request.user = { userId, role }` using the current database account; `AuthenticatedRequest` describes the request type. The guard does not grant access to another user's records: each module owner must scope queries to the authenticated user/provider and implement the required role/ownership policy. The general roles guard and moderator assignment checks are not implemented by this step.

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

## Automated tests

From `backend/`, run:

```powershell
npm.cmd test
```

The tests use an isolated local MongoDB instance and a generated test-only signing secret; they never read the local `.env` or connect to the team's Atlas database. On Windows, the helper first checks for an installed MongoDB server executable and starts a separate instance with a fresh temporary database directory. Otherwise it downloads/caches a test binary. Tests verify registration, credentials, login/cookie/session behavior, logout/revocation/inactivity, lockout/concurrent ordering, current-account checks and rejection cases. They manually forward Secure cookies in the in-memory HTTP client; this is not a browser-cookie policy test. Do not print cookie/token/hash values when diagnosing a failure.
