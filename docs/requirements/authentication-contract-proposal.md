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
| `phoneNumber` | Profile phone number; exact validation and optionality are deferred to ACC-09. |
| `preferredCurrency` | Code from the shared supported-currency reference data. |
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

Forced-password-change restrictions must be enforced on the backend. The exact
endpoints available under this restriction are deferred to the temporary-password
and login features.

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
No unrestricted session is granted to an account with mustChangePassword set
while the required password-change flow is absent.

### ACC-06 current-browser logout and inactivity

ACC-06 uses current-browser logout as a documented implementation choice; the
reviewed sheet does not require all-device logout. The endpoint is POST /api/auth/logout,
with no JSON input. It revokes only sessions identified by the presented refresh
hash and/or verified access JWT session/user claims, then clears both cookies with
matching attributes and returns 204. It also works with an expired access cookie
when the refresh cookie is present, and allows cleanup of an inactive account.
Missing/malformed/repeated credentials are idempotent. Database failure returns
a generic error and preserves cookies for retry; revocation is atomic per document.

The guard's 30-minute idle check and activity update use database time atomically;
rejected requests cannot keep an expired/revoked session alive. Authenticated
activity does not extend the absolute seven-day maximum. Frontend redirection and
storage integration are Milestone 2 work.

Remaining choices for any later token-renewal work: refresh endpoint/rotation/replay
handling and whether background refresh counts as activity; coordinated revocation
after account/password changes; and any future cross-origin deployment. Neither
ACC-06 nor ACC-19 prescribes a refresh endpoint. Until renewal is implemented, an
expired access token requires another login. ACC-19 frontend integration is not
claimed complete by this backend feature.
No new environment-variable name is introduced; JWT_SECRET was already agreed.

## Cross-module details deferred to their respective features

| Concern | Coordination for the relevant feature |
| --- | --- |
| Upcoming bookings | Flight and hotel booking owners provide checks for upcoming Confirmed bookings. Define ongoing hotel stays and the exact date/time boundary. Coordinate concurrent booking confirmation and account deactivation. |
| Deactivated authors | Blog, itinerary, comment, and review owners consistently hide or anonymize content as ACC-12 requires. Agree whether to derive visibility from account status or persist a reversible visibility change. |
| Preferred currency | Profile validation and itinerary budgeting use the same seeded supported currencies. Booking prices, payments, and refunds retain the single platform currency required by PAY-04. |
| Administrative account operations | Agree ownership for ACC-13 to ACC-16: moderator creation, account listing, and suspension/reactivation. |
| Provider status | ACC-15 provider deactivation is separate from moderator suspension. Provider owners enforce search/booking restrictions while preserving existing Confirmed bookings. |
| Booking inspection | ACC-17 administration views consume booking-module data without duplicating booking logic. |
| Notifications/audit | Assign owners and interfaces for mandatory in-app account/provider notifications and audit records of administrative actions. |

Suspension and deactivation must retain their different effects: suspended
users' content stays visible unless separately moderated; deactivated users'
content follows ACC-12.

## Shared specification issues

- GEN-11 requires Pending Payment -> Confirmed -> Completed, with Pending Payment
  -> Expired and Confirmed -> Cancelled as the other allowed booking transitions.
  The current three-value booking enum needs a coordinated update when the
  booking features are implemented. Booking owners will finalize whether
  `PENDING` represents Pending Payment or is renamed, and define `COMPLETED` and
  `EXPIRED` once for both booking modules. This does not affect ACC-01.
- ACC-03 is referenced by the PDF registration endpoint table but absent from the
  reviewed workbook. Do not invent its meaning.

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
