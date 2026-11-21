# M2 shared frontend foundation

Continue in this repository; do not generate another frontend. The starting backend
is fetched `develop` `7665c5849a186823b227be99de3b51bb412ad17b` (20 November 2026).
Node **24** is shared with M1. Dependencies use exact versions and package-lock.json;
use `npm ci`, not an unreviewed dependency upgrade.

| Package | Locked version |
| --- | --- |
| Next.js | 16.4.6 |
| React / React DOM | 19.3.1 |
| TypeScript | 7.0.2 |
| Tailwind / Tailwind PostCSS | 4.3.5 |
| lucide-react | 1.77.0 |
| Inter / Manrope font packages | 5.3.0 |
| Playwright | 1.65.1 |

Versions were resolved from the npm registry on 22 November 2026. TypeScript 7
needs its platform-specific optional compiler package; if a download fails, run
`npm ci --include=optional` and retry. Do not bypass type checking.
Next generates `next-env.d.ts` and route types; these outputs are ignored.
The typecheck command generates them first, so it also works in a fresh clone.

## Run locally

1. Follow the root/backend README to configure the private repository-root `.env`
   and start the real Nest API on `http://localhost:3000`.
2. In `frontend/`, run `npm ci` (`npm.cmd ci` on PowerShell).
3. Copy `.env.example` to `.env.local`. Its only setting is the server-only fixed
   `BACKEND_URL=http://localhost:3000`; the default already matches local setup.
4. Run `npm run dev`, then open `http://localhost:3001`.

Always use **localhost** throughout a browser session. The backend's Secure
`__Host-` cookies work on Chromium's trustworthy localhost exception; outside
loopback use HTTPS. Do not remove Secure, HttpOnly or SameSite protections.
No frontend secrets or tokens belong in public environment variables.

## What is ready

- Next.js App Router, TypeScript, Tailwind 4, Inter/Manrope fonts served locally,
  lucide icons, root layout, header/footer, Coastal Editorial CSS tokens.
- Button, Input, FormField, Card and ErrorAlert primitives, with `/dev/ui` available
  only in development. The remaining shared/domain widgets stay with their builders.
- Real login, `/api/auth/me` session provider, four role landing shells,
  protected read-only account identity, password change and logout. The profile
  route checks the session on the server with explicit cookie forwarding as well.
- Restricted first-login password change survives refresh through
  `/account/security?required=1`. That flag is presentation only: Nest validates
  the protected restricted cookie. Password change requires a fresh login.

This is the team setup slice. Registration, recovery, verification, editable
profile, deactivation, completed navigation and all domain journeys remain later
owner work. The home screen is a starter; it does not claim completed travel
features. Role workspace shells deliberately do not occupy teammates' dashboards.

## API and session conventions

Import `apiClient` and `ApiError` from `@/lib/api/client`. Call an API-relative path,
for example `apiClient('/auth/me')`; write JSON with `JSON.stringify`. FormData
uploads keep the browser's multipart content type. Do not create another client.
Errors expose `status`, `message`, and backend field `fields` arrays. Features own
their loading state and disable duplicate submissions. Use AbortSignal for stale
searches. No automatic write retries or invented refresh endpoint.

Browser requests use relative `/api/*`, credentials include and no-store. The
Node route handler checks a write's exact Origin before forwarding to the fixed
backend, adapts trusted hop headers for Nest's same-origin CSRF policy, forwards
only the three auth cookies, and preserves each Set-Cookie separately. Backend
failures become safe errors; no token is returned in JSON or stored by JS.
Do not proxy Stripe webhooks through the browser: Stripe talks to Nest directly.

Use `useSession` inside client features and `RequireSession` for UX gates; backend
guards remain authoritative. Session reads happen on navigation/focus, with no
polling that silently extends idle sessions. Expired feature requests clear the
session; credential/proof failures keep their inline errors. A version counter
prevents old session reads from replacing a newer login/logout state.
`getServerSession` is the no-store cookie-forwarding adapter for Server Components.
Never cache authenticated API responses in public caches.

There is no `/auth/refresh` endpoint. Access expires after 15 minutes even though
the session also has a 30-minute idle limit and seven-day absolute maximum.
The backend enforces all expiry/status/role changes; log in again after expiry.

Use `formatMoneyMinorUnits` for booking/provider cents and
`formatMoneyMajorUnits` for Payment/Refund dollars and itinerary budgets. Consult
the [exact boundary table](../docs/m2/ROUTES_AND_HANDOFFS.md), not the PDF's blanket
cents shorthand. Read endpoint DTOs for identity fields and list envelopes.

## Checks and disposable browser proof

```bash
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

The browser suite first builds the unchanged backend, then starts the **real Nest
root application** with a disposable local Mongo replica set on 3100 and Next on
3101. It explicitly ignores `.env` and blanks external service settings. Five
synthetic fixture identities/passwords are test-only, never shared Atlas users.
It needs backend dependencies (`npm ci` in backend/) and a supported local Mongo
binary or permission for mongodb-memory-server to download one. Run with loopback
and browser-process permissions. Both ports must be free. Playwright stops owned
servers after the suite; no Stripe/mail/FX service is used for this auth smoke.
To use an already installed Chrome instead of a Playwright download, set
`PLAYWRIGHT_CHANNEL=chrome` for the test process (PowerShell:
`$env:PLAYWRIGHT_CHANNEL='chrome'`). The default is Playwright Chromium.

The suite checks all four roles, live `/me`, refresh, logout/revocation, wrong-role
and real backend forbidden access, forced password change, deep-link return,
hostile redirects/origins, validation, wrong current password, session races and
360/768/1024/1440 layouts. Ignored `test-results/` contains responsive screenshots.
This proves the local browser/proxy/backend integration. Shared Atlas role/access
confirmation and deployment acceptance are separate team checks.

For production packaging run `npm run build`, then `npm start` on 3001. Keep the
fixed backend private and configure HTTPS/origins for the actual deployment before
claiming the optional deployment bonus.

See [team setup](../docs/m2/TEAM_SETUP.md), [routes and handoffs](../docs/m2/ROUTES_AND_HANDOFFS.md),
and the [unchanged official references](../docs/references/README.md).
