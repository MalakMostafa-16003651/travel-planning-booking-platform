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
