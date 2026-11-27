# M2 foundation verification - 22 November 2026

Starting point: fetched `develop` `7665c5849a186823b227be99de3b51bb412ad17b`.
No backend source or existing business data was changed.

| Check | Observed result |
| --- | --- |
| Backend production build | PASS |
| Frontend production build (Next.js 16.4.6, TypeScript 7.0.2) | PASS |
| `npm run typecheck` | PASS |
| Frontend install security audit | 0 vulnerabilities reported by npm |
| `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` | 13/13 PASS, 3.3 minutes, zero retries |
| Responsive login/workspace | 360, 768, 1024, 1440 CSS pixels; overflow assertions PASS; mobile/desktop screenshots inspected |
| Independent AI source review | No remaining blocking finding after session fixes; not human teammate acceptance |
| VS Code | Existing clone opened with the named workspace file |

Browser proof uses Next on localhost:3101 -> the actual Nest root application on
3100 -> a disposable local MongoDB replica set. The fixture disables `.env` reads
and external service settings; no shared Atlas data, real mail, FX or Stripe
service was used. This is local cookie/proxy/auth acceptance, not deployed or
shared-Atlas acceptance.

The 13 browser cases cover:

1. Guest protected-profile redirect, login return, server cookie forwarding and refresh.
2. USER login -> live `/me` -> correct protected workspace -> refresh -> logout -> revoked/absent session.
3. The same complete sequence for ADMIN.
4. The same complete sequence for AIRLINE_MODERATOR.
5. The same complete sequence for HOTEL_MODERATOR.
6. Wrong-role workspace denial and actual Nest admin API 403 for a traveler.
7. Incorrect current password gives an inline error while the normal session remains valid.
8. Incorrect login keeps the backend's generic credentials error.
9. Four hostile return URLs cannot cause an external redirect.
10. A delayed guest `/me` 401 cannot erase a newer successful login.
11. Login/workspace responsive screenshots and overflow checks at all four widths.
12. Restricted password-change login, `/me` denial, refresh, password replacement and mandatory fresh login.
13. Hostile-origin write rejection and preserved backend field validation errors.

The role tests assert Secure/HttpOnly/SameSite=Lax cookies, no auth cookie or token
exposure through document.cookie/localStorage/sessionStorage, no tokens in `/me`
JSON, cleared cookies after logout, and protected-page redirect after logout.

Initial verification history: the first build compiled the app but stopped on a
missing optional Windows TypeScript compiler download. Reinstalling optional
dependencies repaired it; the final build passed without skipping type checks.
The first browser run had 11 passes and two ambiguous alert selectors (Next's
accessibility announcer also has role=alert). The selectors were narrowed to the
actual message; the full fresh 13-case run then passed. No application error was
hidden by those test changes. Existing NO_COLOR/FORCE_COLOR warnings were not
test failures.

Remaining team work: named builder/consumer contract acceptance, individual
repository/environment access checks, shared Atlas role smoke and all later
feature journeys. Domain dashboards, registration/recovery/profile editing and
other full M2 requirements are not certified by this starter. The optional
deployment bonus is not activated. See TEAM_SETUP.md for the pending checklist.

## Malak account and shared UI implementation — 22 November 2026

Branch codex/m2-malak-account-and-shell from develop 0b21779, implementation
commit d41d571, single PR #128. Handoff #127 tracks the integration points for
the home widgets, notification bell, actual role dashboards, booking verification
UI, and the team's SMTP/Atlas verification.

| Check | Result |
| --- | --- |
| Frontend typecheck and production build | PASS |
| Backend production build | PASS |
| Production browser coverage | 25 cases passed in the full run. The corrected unknown-role assertion passed in a separate focused run, covering the remaining case |
| Mobile account flow | 360 px registration, account menu and editable profile fit without horizontal overflow |
| Shared UI gallery | Confirmation keyboard controls, Escape, focus restoration and fit at 360 and 1440 px passed |
| Source review and diff check | Cross-tab account binding, safe redirect, POST form fallback and unknown workspace role checks addressed |

Browser proof uses Chrome, the production Next app, real Nest, disposable local
MongoDB and an in-process test inbox. The cases cover consent and duplicate
email, protected URL and query restoration, four roles, profile persistence,
successful and blocked deactivation, stale account changes, lockout, suspension,
idle expiry, admin reset and restricted password change, and cookie revocation.
The email cases cover verification and resend, stale and reused proofs, generic
reset response and fresh sign-in. For the verification guard, the empty hold
request was rejected as unverified before verification and reached normal DTO
validation afterward. No booking was created in that case.

The initial development-server attempt timed out after deactivation succeeded.
Running against the production build completed the deactivation assertions. In
the production run the unknown role rendered the right not-found page with two
noindex tags. The test now checks for at least one tag and passed when rerun
against the same build.

Acceptance for booking, review, post and itinerary journeys requires the
corresponding owner screens. Final role dashboards, shared Atlas test accounts
and mail delivery through the team's private SMTP inbox need integration checks.

## Shared button styles — 24 November 2026

The frontend production build and its TypeScript check passed. Chrome verified
white text on teal for the home registration link and login submit button,
14 px semibold labels on both controls, and the teal default for the login
recovery link. The home and login pages fit at 360 and 1440 px with no
horizontal overflow. The browser used a stubbed signed-out session because
this check covers CSS.

## Integrated checkout, discovery and account navigation — 27 November 2026

The backend production build, backend test compilation and final frontend
production build passed. Local Chrome used disposable MongoDB replica sets,
with fake Stripe.js and signed webhooks for checkout. All 18 checkout and 13
search-to-booking cases passed. The three focused departure guard regressions
passed. The account run checked wrong-role denial and forced password change.

The final home and admin smoke passed both cases. At 360 px the two search
forms and the public itinerary and story links appeared without page overflow.
The traveler reached the Bookings hub from the account menu, and the admin
returned to the filtered accounts table after signing in.

The integrated build also passed the blog regression for removing hidden
posts and deactivated authors from public lists, and the itinerary check for
sign-in, private cloning and revocation of public access.

The separate shared environment probe authenticated to the Atlas replica set
and Mailtrap over TLS. It performed read-only database commands and SMTP
authentication. Teammate access, delivery to the inbox and Stripe test mode
need their own checks.
