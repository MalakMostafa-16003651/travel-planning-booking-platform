# M2 shared frontend foundation

Continue in this repository; do not generate another frontend. The starting backend
is fetched `develop` `7665c5849a186823b227be99de3b51bb412ad17b` (20 November 2026).
Node **24** is shared with M1. Dependencies use exact versions and package-lock.json;
use `npm ci`, not an unreviewed dependency upgrade.

Everyone starts with [docs/m2/START_HERE.md](../docs/m2/START_HERE.md) and the
26-page optimized split. Named shared builders are listed in the handoff registry;
Malak does not build every shared widget. The included generic money formatters
are starter utilities; Hicham maintains endpoint-specific money/payment adapters.

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

## Account and shared UI

- Next.js App Router, TypeScript, Tailwind 4, Inter/Manrope fonts served locally,
  lucide icons, root layout, header/footer, Coastal Editorial CSS tokens.
- Button, Input, Select, FormField, Card, Badge, ConfirmDialog, EmptyState,
  LoadingState and ErrorAlert. See the development gallery at `/dev/ui`.
- Guest registration with terms/privacy consent, sign-in and logout, safe return
  to a protected page, four role workspaces and responsive account navigation.
- Server-checked account profile with editable name, phone and preferred currency
  from the official currency catalog. Travelers can confirm deactivation and see
  the actual server response if an upcoming confirmed booking blocks it.
- Restricted first-login password change survives refresh through
  `/account/security?required=1`. That flag is presentation only: Nest validates
  the protected restricted cookie. Password change requires a fresh login.
- Password reset request and token completion, email verification and resend.
  Proofs arrive in URL fragments, are held in memory, and are removed from the
  address bar when read. Completion requires an explicit action.

The public home provides `HomeContent` slots for owner-supplied flight, hotel,
itinerary and story components. Their exports and the final domain landing
routes are tracked in [issue #127](https://github.com/MalakMostafa-16003651/travel-planning-booking-platform/issues/127).

The root layout renders static public pages, with client controls for forms,
navigation and live session state. The private profile verifies the server session
on each direct request and loads the account-specific fields without caching.
For travel actions, use `loginHref(returnTo)` from `@/config/routes` or
`RequireSession` with a role where appropriate. Validate the action state again
after sign-in before creating a hold or submitting any mutation.

Profile edits and deactivation bind the displayed user ID to the browser request.
The proxy checks that ID against the same cookie it will forward to Nest. If
another tab has changed the signed-in account, the operation stops and the user
can reload the page to see the current account.

For auth email in local development, configure a private test inbox on the backend
with reset and verification link bases at `http://localhost:3001/reset-password`
and `http://localhost:3001/verify-email`. Set `EMAIL_VERIFICATION_REQUIRED=true`
when testing the booking gate. Use `BookingEmailGate` from
`@/features/auth/email-verification` around the booking/payment action and handle
the authoritative API rejection. For a link opened in a separate tab, return to
the original tab and choose **Check verification again** or retry the original action.

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

The browser suite builds both apps, then starts the **real Nest root application**
with a disposable local Mongo replica set on 3100 and the production Next build
on 3101. The backend fixture ignores `.env` and blanks external service settings. It uses
synthetic fixture identities and an in-process mail sink for reset/verification.
It needs backend dependencies (`npm ci` in backend/) and a supported local Mongo
binary or permission for mongodb-memory-server to download one. Run with loopback
and browser-process permissions. Both ports must be free. Playwright stops owned
servers after the suite; no Stripe/mail/FX service is used for this auth smoke.
To use an already installed Chrome instead of a Playwright download, set
`PLAYWRIGHT_CHANNEL=chrome` for the test process (PowerShell:
`$env:PLAYWRIGHT_CHANNEL='chrome'`). The default is Playwright Chromium.

The suite checks all four roles, login and session changes, expiry/lockout,
registration and profile validation, deactivation, recovery and verification,
deep-link return and responsive layouts. Ignored `test-results/` contains
responsive screenshots. Use the team's Atlas and private test inbox for the
shared-environment verification.

For production packaging run `npm run build`, then `npm start` on 3001. Keep the
fixed backend private and configure HTTPS/origins for the actual deployment before
claiming the optional deployment bonus.

See [team setup](../docs/m2/TEAM_SETUP.md), [routes and handoffs](../docs/m2/ROUTES_AND_HANDOFFS.md),
and the [unchanged official references](../docs/references/README.md).
