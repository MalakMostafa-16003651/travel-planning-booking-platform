# Authentication and Users: shared contract

Status: accepted baseline for ACC-01 implementation. On 2026-11-01, after
reviewing PR #1, the team leader confirmed agreement with the shared User fields
and naming and authorized implementation one requirement at a time. Session
settings and cross-module details listed below are deferred to their respective
features; they do not block registration.

Scope: Person 1, Authentication and Users, for Milestone 1. The official reviewed
requirements workbook defines functional rules; the project PDF defines the
architecture and delivery requirements. The team's naming and Git rules apply.

## Confirmed requirements

| ID | Required behavior |
| --- | --- |
| ACC-01 | Registration requires name, unique valid email, terms/privacy consent, and a password with at least eight characters, one letter, and one digit. |
| ACC-04 | All account roles log in with email and password. Invalid credentials receive a generic error; suspended accounts receive a suspension message. |
| ACC-05 | Five consecutive failed logins lock the account for 15 minutes and show a lockout message. Successful login resets the counter. |
| ACC-06 | Logout clears authentication cookies and revokes the refresh token on the server. Thirty minutes without an authenticated request expires the session. |
| ACC-07a | An administrator can set a temporary password for a user or moderator. The account must change it at the next login. |
| ACC-08 | Password changes require the current password and a compliant new password. |
| ACC-09 | All logged-in roles can update name, phone number, and preferred currency, subject to validation. Email changes are not specified. |
| ACC-10 | Guests attempting restricted actions must log in and return to the intended action. Frontend navigation is delivered in Milestone 2. |
| ACC-11 | Private bookings and itineraries require ownership. Administrators may view all bookings; moderators may view bookings for their assigned provider. These exceptions do not grant general access to private itineraries. |
| ACC-12 | Registered users can deactivate their own accounts after confirmation, unless they have upcoming Confirmed bookings. Deactivation prevents login, hides posts and public itineraries, and displays comments/reviews as Deleted user. |
| ACC-18 | Administrator accounts are seeded; administrator self-registration is prohibited. |
| ACC-19 | Access and refresh tokens use httpOnly, Secure, SameSite cookies. Authentication tokens and credentials must not enter JavaScript-accessible storage. The frontend obtains its current identity from /api/auth/me. |
| GEN-13 | The backend enforces validation, business rules, and authorization. Passwords are stored only as salted hashes. |

Email verification (ACC-02) and email-based password recovery (ACC-07) are bonus
features. They are outside the initial mandatory implementation.

## Existing team agreements

- Persist MongoDB document identifiers as `_id`, with Mongoose timestamps
  `createdAt` and `updatedAt`.
- Use references named `userId`, `moderatorId`, `airlineId`, and `hotelId`.
- Define one shared role enum: `USER`, `ADMIN`, `AIRLINE_MODERATOR`,
  `HOTEL_MODERATOR`.
- Define one shared account-status enum: `ACTIVE`, `SUSPENDED`, `DEACTIVATED`.
- Keep temporary failed-login lockout separate from account suspension.
- Use the `/api` prefix, NestJS naming conventions, DTO validation, Swagger,
  meaningful tests, and the shared AI prompt log.
- Keep secrets in local `.env` files and commit only credential-free examples.

## Accepted shared data contract

The shared User field names and naming conventions below are the accepted
baseline. ACC-01 implements the fields needed for registration. Fields and
behavior for later requirements are added with those features.

### User

| Field | Agreed meaning |
| --- | --- |
| `_id` | MongoDB identity; expose its string value as `userId` in API responses without storing a second identifier. |
| `name` | User's display name. |
| `email` | Trimmed, lowercase email with database-enforced uniqueness. Uniqueness is case-insensitive after normalization. |
| `passwordHash` | Salted password hash; never returned in API responses. |
| `credentialVersion` | Private nonnegative safe integer, default zero, incremented atomically with password reset/change; sessions retain the verified version. Agreed by the team leader on 2026-11-04. |
| `phoneNumber` | Optional profile phone number; ACC-09 accepts international syntax (+ and 8–15 digits) when supplied. Omission preserves it; null/blank updates are rejected. |
| `preferredCurrency` | Optional uppercase code from the shared Currency catalog; no automatic default. |
| `role` | One value from the shared role enum; each account has a single role. |
| `status` | One value from the shared account-status enum. |
| `mustChangePassword` | Restricts accounts using administrator-set temporary passwords until they change the password. |
| `failedLoginAttempts` | Consecutive failed-login counter; never returned publicly. |
| `lockedUntil` | Temporary login lockout expiry; distinct from account status. |
| `termsAcceptedAt` | Timestamp recording acceptance of the mandatory terms-and-privacy consent during registration. |
| `createdAt`, `updatedAt` | Mongoose timestamps. |

Public registration creates `USER` accounts. Registration and profile DTOs must
not allow callers to assign privileged roles or change account status. Public
responses must allowlist their fields and exclude password/session information.

### ACC-09 own profiles and the shared Currency catalog

`GET /api/users/me` and `PATCH /api/users/me` use the authenticated owner for all
four roles. The profile response adds optional phoneNumber/preferredCurrency to
the existing public account fields; login/registration/auth-me JSON is unchanged.
PATCH accepts only name, phoneNumber and preferredCurrency; all supplied values
must validate before an atomic field update. Empty patches and supplied null/blank
values are rejected. Omission retains existing fields, and no default is assigned.
The mutation also matches the authenticated credential version and current
eligible account state so a stale request cannot survive a password reset.

On 2026-11-04 the team leader explicitly requested creation of one catalog for
Kiki (Person 7) to reuse. `Currency` uses collection `currencies`, fields `_id`,
`code`, `name`, `createdAt`, `updatedAt`; code is unique, uppercase and three
letters. Initial codes are AED/EGP/EUR/GBP/JPY/SAR/USD, derived from the PDF-linked
[Countries.csv](https://docs.google.com/spreadsheets/d/1SlKUTRqlHuBJAMC-Z-QOZzSrzKpGHT_TgQUI5gVm-BA/edit?gid=2042930643).
The revised PDF section 5.1 explicitly defines supported currencies as the codes in Countries.csv. Supported queries and validation enforce this official set; extra stored rows are not automatically supported. Any future official dataset update must be coordinated once in this shared catalog.

Import CurrenciesModule and inject its exported CurrenciesService to call
`listSupported()` or exact-canonical `isSupported(code)`. Public
`GET /api/currencies` returns sorted `{ code, name }` pairs for selectors. Run
`npm.cmd run seed:currencies` from backend for explicit setup; startup does not
seed automatically. The idempotent seed preserves existing rows/names/timestamps
and does not delete extra stored rows; supported queries exclude unofficial codes. No public currency-write API,
FX conversion, new secret name or payment-currency change is introduced.

Malak implements profile preference storage/validation and the requested shared
catalog. Kiki owns itinerary/budget/FX usage and coordinates any currency changes;
Gamila coordinates integration with airport/reference-data seeding if needed.
The student will share the handoff; AI does not message teammates automatically.

### ModeratorAssignment

Shared naming for the moderator feature: `_id`, `moderatorId`, `airlineId` or
`hotelId`, `createdAt`, `updatedAt`.

- `moderatorId` references a User account.
- Exactly one provider reference is present and matches the moderator role.
- Each moderator has exactly one assignment. The requirements do not establish
  a limit of one moderator per provider.
- Provider validation and reassignment behavior are deferred to the moderator
  and provider features with the affected owners.

### Authenticated identity and guards

Shared identity available to feature controllers: `userId` and `role`, with a
validated provider assignment available when moderator scope is needed.

Person 1 supplies reusable authentication and role checks. Each module owner
enforces resource ownership and provider restrictions on that module's queries
and operations. Client-provided identifiers are not proof of ownership.

Forced-password-change restrictions are enforced on the backend. Restricted
credentials permit only the password-change and logout operations described below.

## Session settings agreed for ACC-04

On 2026-11-03, after an explanation, the student selected "Use these settings":
15-minute access tokens, seven-day maximum refresh tokens, 30-minute inactivity
expiry, private AuthSession storage with only a refresh-token hash, HttpOnly/Secure/
SameSite=Lax cookies named `__Host-accessToken` and `__Host-refreshToken`, the
existing JWT_SECRET name, and a same-origin frontend/API. Refresh and logout
behavior remain separate implementation steps, as stated in the proposal.

The private AuthSession uses `_id`, `userId`, `refreshTokenHash`, `lastActivityAt`,
`expiresAt`, `revokedAt`, `createdAt`, `updatedAt`. The refresh token is random and
opaque; its SHA-256 hash is stored with a unique index. `expiresAt` is an absolute
seven-day maximum. Cookie Path=/ and no Domain enforce the `__Host-` convention.
Authenticated requests verify access JWTs and the session, reload the account's
current role/status, and atomically advance activity. TTL cleanup does not replace
expiry checks. Same-origin CSRF protection applies to browser writes; CORS is not
opened. HTTPS is required outside localhost development; Secure stays enabled.

AuthGuard is exported by AuthModule and supplies `request.user = { userId, role }`.
Each feature owner still enforces their resource's role/ownership restrictions.
AuthModule also exports RolesGuard. Role-restricted routes use
`@UseGuards(AuthGuard, RolesGuard)` followed by `@Roles(UserRole.ADMIN)` or the
required shared roles. Method policy overrides controller policy; missing/empty
role policy fails closed. Client-supplied roles never establish identity.
Accounts with mustChangePassword receive a restricted password-change session,
never a normal authenticated identity or access/refresh pair.

### ACC-07a / ACC-08 agreed password management

On 2026-11-04 the student selected **"Use this design"** for private
`credentialVersion` on User/AuthSession, a 15-minute HttpOnly restricted
password-change cookie, administrator-chosen compliant temporary passwords never
returned by the API, and a fresh login after password change. The restricted
cookie is backed by an existing AuthSession so logout revokes it server-side.
The session uses the existing fields plus the private credential version; it has
a 15-minute absolute expiry and no issued refresh token. Tokens have a distinct
signed `tokenUse` and cannot be used in normal authentication.

ADMIN-only `POST /api/admin/users/:userId/reset-password` accepts
`temporaryPassword` for USER/AIRLINE_MODERATOR/HOTEL_MODERATOR targets. It keeps
the target's status unchanged, resets failed-login lockout, sets mustChangePassword
and increments the credential version. Administrator targets are excluded.

The next eligible login returns only `passwordChangeRequired: true`, clears normal
cookies and sets `__Host-passwordChangeToken` with the existing secure cookie
attributes. `PATCH /api/auth/change-password` accepts `currentPassword` and a
compliant, different `newPassword`, using either that restricted cookie or the
caller's normal access cookie. Success clears all authentication cookies and
requires login. No caller-supplied user ID controls password-change ownership.

Version increments and password/flag/counter writes are atomic on User. Old
normal/restricted sessions are logically invalidated without relying on TTL or
successful multi-document cleanup. Legacy missing versions mean zero. Session
issuance preserves the version verified with credentials; guards recheck current
account/version after touching activity. In-flight operations already accepted
before a reset are not claimed retroactively rolled back.

The workbook lists ACC-14 account listing as an ACC-07a dependency; that module
remains Arwa's separate work. ACC-18 is implemented by explicit administrator
setup (`npm.cmd run seed:admin`), with no public admin registration endpoint.
Existing administrators are preserved, non-admin email collisions are rejected,
and credentials use the existing registration policy and salted hash format.
Temporary-password
delivery is outside this API, and frontend flow remains Milestone 2.

### ACC-06 current-browser logout and inactivity

ACC-06 uses current-browser logout as a documented implementation choice; the
reviewed sheet does not require all-device logout. The endpoint is POST /api/auth/logout,
with no JSON input. It revokes only sessions identified by the presented refresh
hash and/or purpose-verified access/password-change JWT session/user claims, then clears all three cookies with
matching attributes and returns 204. It also works with an expired access cookie
when the refresh cookie is present, and allows cleanup of an inactive account.
Missing/malformed/repeated credentials are idempotent. Database failure returns
a generic error and preserves cookies for retry; revocation is atomic per document.

The guard's 30-minute idle check and activity update use database time atomically;
rejected requests cannot keep an expired/revoked session alive. Authenticated
activity does not extend the absolute seven-day maximum. Frontend redirection and
storage integration are Milestone 2 work.

Remaining choices for any later token-renewal work: refresh endpoint/rotation/replay
handling and whether background refresh counts as activity; future account-status
mutation coordination; and any future cross-origin deployment. Password changes
now invalidate sessions through credential versions. Neither
ACC-06 nor ACC-19 prescribes a refresh endpoint. Until renewal is implemented, an
expired access token requires another login. ACC-19 frontend integration is not
claimed complete by this backend feature.
No new environment-variable name is introduced; JWT_SECRET was already agreed.

## Cross-module details deferred to their respective features

### Milestone 1 acceptance boundary: ACC-10 / ACC-19

| Requirement part | Backend evidence | Remaining work |
| --- | --- | --- |
| ACC-10: guests cannot perform restricted actions | AuthGuard rejects absent/invalid/expired credentials with JSON 401. Own-profile/identity, password and admin operations have guards; current flight-booking routes reuse AuthGuard. | Each future review/blog/booking owner must apply the shared guard. Login navigation and returning to the intended action require the Milestone 2 frontend. |
| ACC-19: protected cookie issuance | Access/refresh cookies share HttpOnly, Secure, SameSite=Lax, Path=/ and no Domain. Tokens are not JSON fields; refresh storage is hashed. | Verify the actual frontend/browser deployment honors these attributes. |
| ACC-19: current identity | GET /api/auth/me returns only the public identity and validates live account/session state. Bearer-only and refresh-only credentials do not authorize it. | Frontend retrieves identity here instead of reading/storing tokens. |
| ACC-19: no JavaScript-accessible credential storage | No localStorage/sessionStorage/document.cookie access or token-storage code was found in the current backend source. | No frontend exists in this repository yet; browser storage, reload/logout and return-to-action behavior remain unverified. This is not a full ACC-19 completion claim. |

The workbook requires login-and-return behavior for ACC-10 and cookie/identity/
storage behavior for ACC-19. M1 backend readiness does not complete the frontend
clauses. No refresh endpoint is mandated by these rows, and none is added as an
audit side effect. Missing sessions receive JSON errors; backend APIs do not
replace those responses with browser redirects.

Public registration/login, the public currency catalog and Swagger remain
intentional public routes. Logout accepts optional credential proofs so cleanup
works after expiry; that does not grant access to other protected operations.
Restricted password-change credentials remain confined to change/logout.

For ACC-11's next integration, contact Arwa (Person 2) to confirm the agreed
ModeratorAssignment lookup interface: moderatorId, exactly one airlineId/hotelId,
matching moderator role and current assignment. Gamila/Lama enforce assigned
provider scope; Ismail/Osama enforce booking ownership/provider inspection; Kiki
enforces private itinerary ownership. Admin booking exceptions do not grant
general access to private itineraries. Do not duplicate another owner's module
or treat client-supplied provider/user IDs as authorization.

| Concern | Coordination for the relevant feature |
| --- | --- |
| Upcoming bookings | Flight and hotel booking owners provide checks for upcoming Confirmed bookings. Define ongoing hotel stays and the exact date/time boundary. Coordinate concurrent booking confirmation and account deactivation. |
| Deactivated authors | Blog, itinerary, comment, and review owners consistently hide or anonymize content as ACC-12 requires. Agree whether to derive visibility from account status or persist a reversible visibility change. |
| Preferred currency | Malak's profile validation and Kiki's budgeting reuse CurrenciesModule/CurrenciesService and collection currencies. Coordinate reference-data seeding with Gamila. Booking prices, payments, and refunds retain the single platform currency required by PAY-04, owned by Hicham. |
| Administrative account operations | Arwa (Person 2) owns moderator creation, account listing, suspension/reactivation and their admin APIs; coordinate account fields/guards with Malak. |
| Provider status | ACC-15 provider deactivation is separate from moderator suspension. Provider owners enforce search/booking restrictions while preserving existing Confirmed bookings. |
| Booking inspection | Arwa's ACC-17 administration views consume Ismail's flight-booking and Osama's hotel-booking data without duplicating booking logic. |
| Notifications/audit | Arwa owns shared in-app notification functionality and audit logs. Feature owners agree the calling interfaces with her. |

Suspension and deactivation must retain their different effects: suspended
users' content stays visible unless separately moderated; deactivated users'
content follows ACC-12.

## Shared specification issues

- GEN-11 requires Pending Payment -> Confirmed -> Completed, with Pending Payment
  -> Expired and Confirmed -> Cancelled as the other allowed booking transitions.
  The team's published flight-booking implementation, imported from PR #8,
  already adds `COMPLETED` and `EXPIRED` to the shared booking enum and retains
  `PENDING` for the unpaid hold. This records the integrated source, not a claim
  that every booking owner accepted its proposal. Flight/hotel/payment owners
  must coordinate remaining contract decisions; Person 1 does not redefine it.
- The revised PDF corrects registration mapping to ACC-01 only, resolving the old unexplained ACC-03 reference. GET /api/auth/me maps to ACC-04/ACC-19; GET /api/users/me remains the own-profile authorization endpoint.

## Approval and incremental implementation

The team leader approved the shared User fields and naming on 2026-11-01 after
reviewing PR #1: "i reviewed the PR, and we agree on them lets implement one by
one together". ACC-01 registration is the first implementation step. The remaining
session settings and cross-module details are addressed with their respective
features rather than blocking this step. Approval does not assign Person 1 every
Administration or supporting-service feature.

Implementation proceeds in coherent feature branches from the latest
`develop`, with tests, Swagger documentation, requirement references, and updates
to the [continuous student workflow record](../work-logs/16003651.md). That record
documents the requested prompt-log consolidation and the course filename
requirement awaiting TA confirmation. Synchronize by merging updated `develop`
before opening a PR.
All changes go through PR review into `develop`; stable milestones reach `main`
through a release PR. Never force-push.

## Shared internal Users helpers (2026-11-06)

UsersModule exports UsersService.getAccountStatuses(userIds): Promise<Map<string, AccountStatus>> and getDisplayNames(userIds): Promise<Map<string, string>>. Both select only requested fields, validate/normalize/deduplicate IDs and omit missing records; names also omit DEACTIVATED users. They return no credentials and expose no public user-directory endpoint. Itineraries binds its attribution/status ports to this service instance. Public author access fails closed on status errors; a proven owner's own response does not need a second eligibility lookup.

The team leader approved ReferenceDataModule with Country {code,name,currency} and City {cityId,name,countryCode}, timestamps and unique official identifiers. Reuse it for reference validation; setup is explicit via seed:references.


## ACC-07 bonus: emailed forgotten-password reset (approved 2026-11-08)

Malak requested the bonus and approved: **"Approve these names and design"** for SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM and PASSWORD_RESET_URL, private hashed reset records, 30-minute single-use links, newer-request invalidation and fresh login after completion. No User schema, role or account-status change is needed. Person1 owns this auth flow; the exported MailModule/MailService is available for future coordinated reuse, but GEN-01-B notification emails and ACC-02 verification are not implemented here.

- POST /api/auth/forgot-password accepts only normalized email. Returns202 with the same message for active, unknown, suspended, deactivated and silently limited addresses. Known/unknown requests perform the same indexed persistence before response; user lookup and SMTP delivery run afterward on a bounded in-process queue (four workers; at most30 pending/reserved/active jobs). A request never changes passwords, lockout state, roles or account status.
- POST /api/auth/reset-password accepts only token and newPassword in JSON; success204 clears authentication cookies and requires fresh login. Existing CompliantPassword and PasswordService are reused. No login cookie/token is issued. Invalid/expired/used/superseded/ineligible proofs return the same400 invalid-link message; invalid DTO fields retain shared field errors.
- Private PasswordReset stores an HMAC email key, SHA-256 token hash, optional bound userId/credentialVersion, issuance time, expiry and timestamps. No plaintext token/email is persisted there. SHA-256 hashes a cryptographically random256-bit token. Accepted replacement requests overwrite the hash immediately; superseded queued workers cannot rebind the replacement. Expiry is enforced in database predicates rather than relying on eventual TTL deletion.
- A private TTL PasswordRecoveryLimit collection stores HMAC keys/counts, not plaintext IP/email. Fixed15-minute windows allow20 request attempts per IP and5 accepted requests per normalized email. Additional requests get the same202 without generating mail/replacing the link. Reset submissions allow20 well-formed attempts per IP, then429. Invalid DTOs fail before service work. Client addresses come from the socket/default trusted Express request IP; forwarded headers are not blindly trusted. Deployment behind a proxy needs an explicitly reviewed trust configuration.
- Token consumption and UsersService.replacePassword run together in one Mongo transaction. replacePassword now takes an optional ClientSession; all existing callers keep their behavior. Its existing active-account/hash/credentialVersion compare-and-swap increments the version exactly once, invalidating both normal and restricted older sessions. Admin resets, own password changes, concurrent redemptions and newer requests cannot be overwritten by stale recovery work.
- MailService uses Nodemailer with verified TLS (implicit on465; required STARTTLS otherwise), bounded10-second connection/greeting/socket timeouts, disabled protocol logging and disabled file/URL content loading. Trusted sender is SMTP_FROM; recipients/body come from typed internal calls. Delivery errors are logged generically without addresses, raw errors, links, tokens, credentials or SMTP content. Failed delivery removes only its own token version, never a newer one.
- Mail configuration may be wholly absent without preventing backend startup; recovery requests then uniformly return503. Partial SMTP settings fail validation without secret values. PASSWORD_RESET_URL must be HTTPS (loopback HTTP allowed locally), without embedded credentials/query/fragment. Request Host/Origin never constructs the link. Tokens appear in the trusted page URL fragment, then the M2 client submits them in a POST body; M1 Swagger testing can copy the fragment token from the development inbox. This change creates no M2 page.
- Queue delivery is deliberately not durable. An interrupted process can drop accepted queued mail; the user requests another link. SMTP failure/acceptance202 never proves inbox delivery. No raw-token outbox, automated retry promise or production-provider check is claimed.

Configure secrets only in ignored .env; commit only .env.example. Keep password-reset page/third-party assets from leaking fragments and use no-referrer when the M2 client is built. SMTP setup uses a development test inbox. Live SMTP credentials/inbox demonstration are operator setup and must be verified separately.

References checked for this implementation: [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [Nodemailer SMTP](https://nodemailer.com/smtp), [Mongoose transactions](https://mongoosejs.com/docs/transactions.html). Final executed test evidence is recorded in the single student log. Feature is prepared on the existing session branch, awaiting review/merge.

Final ACC-07 check: production build/test compilation PASS; complete isolated suite527/527 PASS,60 suites (847929.7181ms), source c6410b0. Real inbox delivery remains a separate manual setup check. The future reset page must follow the already-agreed same-origin frontend/API deployment and CSRF policy.


Session publication (2026-11-08): [PR55](https://github.com/MalakMostafa-16003651/travel-planning-booking-platform/pull/55) contains the approved ACC-11 integration and ACC-07 backend. The team leader requested merging the saved edits. Use the PR record for the final merge state; tests/setup limits remain as documented. Before merging Osama's separate fix/HTL-22-reservations-port-shape branch, reconcile its per-room roomId/guests output with this approved rooms[]/guestCount/bookingReference contract.


## ACC-02 accepted implementation and booking handoff - 2026-11-09

Malak approved User.emailVerifiedAt, EMAIL_VERIFICATION_URL and default-off EMAIL_VERIFICATION_REQUIRED, private24-hour single-use latest-email proofs and the reusable booking guard/service. On2026-11-09 she explicitly resolved the later no-teammate-edits constraint: **"Add only the required verification checks (recommended)"**. Accordingly the only teammate implementation edits are calls/injection of EmailEligibilityService in FlightBookingsService, HotelBookingsService and PaymentsService. No booking schema, financial algorithm, role/status enum, target ownership rule or new environment name is introduced.

- Current endpoints: GET /api/auth/email-verification (own booleans), POST /api/auth/resend-verification (own normal session, generic202), POST /api/auth/verify-email (proof-only204). Registration queues email when ready; failed delivery does not misreport registration failure. No automatic login.
- New holds/payment attempts require a currently active verified account when the flag is on. Flight confirmation rechecks in its transaction before converting inventory. Hotel hold creation rechecks in its transaction. Late ineligible payment success follows the existing full-refund path; transient eligibility lookup failure propagates for retry. Confirmed history and idempotent replay remain valid.
- SMTP configuration plus trusted verification URL are required before activation. The flag remains false in the example; private .env is not changed. Existing unverified/legacy accounts need proof too. Profiles cannot edit email; any future email-change operation must clear verification/invalidate prior proofs atomically.
- Future paid hotel confirmation, which is not yet implemented by its owner, must reuse EmailEligibilityService.canBook(userId, session) before inventory state writes. The generic PaymentsService check already gates its booking-port confirmation calls for either type. Do not duplicate verification fields, proof storage or enums in booking modules.
- Full operational instructions are in backend/README.md. The single student log records executed tests and their limits; automated fake delivery does not prove a real inbox or real Stripe account. M2 client pages are outside this M1 backend change.

## ACC-12: approved account/confirmation transaction coordination (2026-11-09)

Malak explicitly approved adding private User.bookingVersion and integrating the same check in Ismail's flight and Osama's hotel confirmation methods. This is separate from credentialVersion: successful NEW booking confirmations increment bookingVersion without logging the user out. Successful self-deactivation increments credentialVersion once to invalidate old credentials and revokes all existing sessions. bookingVersion defaults to0, is select:false, and missing legacy values count as0; malformed/exhausted counters fail closed rather than overflowing or silently resetting.

POST /api/users/me/deactivate accepts only {"confirmed":true}, uses the real normal-cookie AuthGuard/USER role and derives userId/credentialVersion only from that session. AccountDeactivationModule composes the existing Auth, Users, FlightBookings and HotelBookings modules without adding booking dependencies to persistence-only UsersModule or AuthModule. In one transaction it first writes the User via UsersService.acquireBookingGate, checks BOTH real hasUpcomingConfirmedBookings helpers with that same ClientSession, conditionally changes the still-current active USER account to DEACTIVATED, revokes existing auth sessions and removes bound password-reset/email-verification proofs. All errors roll back the transaction and preserve cookies; success204 clears all three host cookies through the shared auth helper. Credentials/password/profile/content records are retained. A concurrent session issued with an old epoch remains unusable even if its record races revocation.

Both NEW booking confirmation transactions write the same User gate before inventory/status conversion. A User write conflict forces retry with current data: confirmation first means the upcoming booking blocks deactivation; deactivation first means the active-account confirmation gate fails and Payments compensates the late charge. Already-confirmed same-payment replay bypasses the counter and preserves history. Flight eligibility includes a future return leg via lastDepartureAt; hotel eligibility includes ongoing stays until the UTC checkout date, without waiting for completion maintenance. Dependency errors are not treated as no bookings. This is a per-account database transaction check, not an in-memory lock, ordinary credential-version counter or replacement inventory algorithm.

The gate applies to self-deactivation and the two agreed confirmation paths. Provider/room deactivation ordering is still a separate issue. Pending holds do not block account deactivation; they remain subject to existing expiry/release and payment compensation. Existing public content readers hide deactivated users' posts/public itineraries and anonymize retained comments/reviews as Deleted user. M2 account confirmation UI and operator SMTP/Stripe demonstrations are not added by this backend work. Final test evidence is in the continuous student log.


## ACC-07a audit integration - 2026-11-10 (approved, pending PR review)

Malak approved the shared PASSWORD_RESET audit enum and optional persistence-session interfaces. The admin reset controller supplies request.user.userId as the actor; clients cannot supply or override it. PasswordManagementService.setTemporaryPassword now requires that adminId as its third argument. It hashes before the transaction, then joins UsersService.setTemporaryPassword and AuditLogsService.log in one commit. A failed audit rolls back the password, mustChangePassword, credential epoch and lockout reset. The append-only audit records actor/target/action only, with no password/hash/token details. Existing temporary-password delivery, restricted-change cookie and account-status rules are unchanged. Auth imports the shared audit persistence module, avoiding a dependency on guarded audit HTTP controllers.
