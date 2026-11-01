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
| ACC-05 | Five consecutive failed logins lock the account for 15 minutes. Successful login resets the counter. |
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

## Session settings deferred to login and session features

The requirements mandate access and refresh cookies, refresh-token revocation,
and 30-minute inactivity expiry. Finalize these settings when implementing the
relevant login and session features:

1. Access-token lifetime, refresh-token lifetime, and refresh endpoint/behavior.
2. Server-side session representation, refresh rotation, and replay handling.
3. How authenticated activity updates inactivity expiry and whether a background
   refresh counts as activity.
4. Whether logout revokes the current session or every session.
5. Session revocation following password changes, resets, suspension, and
   deactivation.
6. Cookie names, SameSite value, CSRF protection, frontend origin/CORS rules, and
   local HTTPS configuration for the required Secure cookies.

No new environment-variable names are introduced by this contract. Any additions
must follow the team's agreement process.

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
to `AI_PROMPTS.txt`. Synchronize by merging updated `develop` before opening a PR.
All changes go through PR review into `develop`; stable milestones reach `main`
through a release PR. Never force-push.
