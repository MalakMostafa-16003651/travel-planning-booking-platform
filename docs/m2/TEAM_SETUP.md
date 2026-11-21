# M2 team setup and review checklist

Prepared 2026-11-22. This is a working access/review checklist, not a claim that
all eight people have received access or signed off. No messages or invitations
were sent as part of preparing it.

Send everyone the [single start-here guide](START_HERE.md). The agreed assignment
reference is the **26-page optimized split**, not the superseded 37-page original.
Malak confirmed she has sent the optimized PDF; individual read acknowledgements
and builder/consumer acceptance still need recording. PR #125's foundation is merged.

## Starting point and local environment

Use the existing repository:
`https://github.com/MalakMostafa-16003651/travel-planning-booking-platform`.
M2 continues the submitted M1 backend in `backend/`; the shared app is `frontend/`.
The foundation was prepared from fetched `origin/develop` commit
`7665c5849a186823b227be99de3b51bb412ad17b` (2026-11-20). `main` is the submitted
stable release; feature work integrates through `develop`.

Everyone pulls the merged foundation and branches from the latest develop:

```bash
git fetch origin --prune
git switch develop
git pull --ff-only origin develop
git switch -c feature/<requirement-id>-<short-name>
```

Use **Node.js 24** and the committed package locks. Run `npm ci` separately in
`backend/` and `frontend/`. On PowerShell use `npm.cmd` if script execution policy
blocks `npm.ps1`. Follow the [root README](../../README.md),
[backend README](../../backend/README.md), and frontend README for the exact
startup commands and proxy environment names.

The backend listens on `http://localhost:3000`; the frontend listens on
`http://localhost:3001`. Set the frontend's server-only
`BACKEND_URL=http://localhost:3000` using its `.env.example`/README, then run
`npm run dev` in `frontend/`. Open the frontend address for browser flows; Swagger
remains at `http://localhost:3000/api/docs`.

Keep the backend `.env` at the repository root. Copy `.env.example` and obtain
values privately from the team lead; copying an example does not configure Atlas,
mail, Stripe or FX. Atlas must support transactions (replica set). Seed reference
data and admin only according to the backend README and the team's database
arrangements. Do not run destructive reset scripts against the shared database.

The frontend calls relative `/api` paths through the approved same-origin proxy.
There is no `NEXT_PUBLIC_API_BASE_URL`: the browser never needs a separate API
origin. The proxy preserves authentication cookies and each `Set-Cookie` header,
validates browser write origins, and forwards requests to the configured backend.
Use the same loopback hostname throughout local testing; do not alternate
`localhost` and `127.0.0.1`. Keep Secure cookies enabled. Outside loopback,
frontend and API need a correctly configured HTTPS same-origin setup before
claiming deployment readiness.

For the foundation smoke, login leads to `/workspace/traveler`, `/workspace/admin`,
`/workspace/airline`, or `/workspace/hotel`; those are shared integration shells,
not completed domain dashboards. `/account/profile` displays the current
session identity for every role; profile editing is a later Malak slice.
The forced-password-change prompt lives at `/account/security?required=1`;
it must still work after refresh,
and the backend's restricted cookie is the actual authority.

Never commit `.env`, local test credentials, Atlas URIs, signing keys, SMTP/FX
secrets, Stripe secret keys or webhook secrets. Do not paste them into the team
PDF, AI prompts, logs or screenshots. Only Stripe's test **publishable** key may
be public when Hicham integrates checkout. Use test mode and test accounts.

## Access checklist: record evidence, then mark complete

| Item | Lead action | Evidence/state |
| --- | --- | --- |
| Repository access for all eight | Confirm each named teammate can clone, push a feature branch and open a PR | Pending individual confirmation |
| Official workbook | Read [official-requirements.xlsx](../references/official-requirements.xlsx) | Original copied unchanged into repo; individual access/read acknowledgement pending |
| Revised description | Read [revised-project-description.pdf](../references/revised-project-description.pdf) | Revised original copied unchanged into repo; individual access/read acknowledgement pending |
| Optimized M2 split | Read [milestone-2-team-split.pdf](../references/milestone-2-team-split.pdf) | Malak confirmed the optimized PDF was sent; canonical repo copy updated; individual read acknowledgement pending |
| Local environment | Each teammate installs Node 24, runs locked installs, starts API/frontend and opens Swagger | Pending fresh-clone check per teammate |
| Private environment values | Provide values over the established private channel; verify Atlas network access and test role accounts | Pending recipient confirmation; no secret values recorded here |
| Routes/component contracts | Builders and consumers review [ROUTES_AND_HANDOFFS.md](ROUTES_AND_HANDOFFS.md) | Draft ready; acceptance pending |
| Review arrangements | Each owner identifies a peer who checks integration before Malak's final review | Suggested pairings below; acceptance pending |

The repository's [ownership matrix](../requirements/milestone-1-ownership-matrix.md)
is a convenient transcription, not a substitute for access to the official
workbook. The original workbook, revised description and unified team handoff
are now versioned in `docs/references/`; their
[provenance and SHA-256 hashes](../references/README.md) identify the exact inputs.
Their inclusion in this PR provides one repository destination; each teammate's
repository access and read acknowledgement still need confirmation.

## Peer checks, then final Malak review

Suggested pairs follow the integration boundaries; the team still needs to
confirm who performs each check.

| Author | Peer integration check |
| --- | --- |
| Malak | Arwa checks role/auth flows; an additional consumer checks shared UI/API imports |
| Arwa | Malak checks guards and shared header; relevant content owner checks reports |
| Gamila | Ismail checks selected segment/cabin handoff |
| Ismail | Gamila checks selected flights; Hicham checks checkout handoff |
| Lama | Osama checks room/date/guest handoff |
| Osama | Lama checks embedded reviews; Hicham checks hotel checkout handoff |
| Kiki | Hicham checks itinerary attachment; flight/hotel owners check search prefills |
| Hicham | Ismail or Osama checks payment states; Kiki checks post attachment |

1. Open one focused PR into `develop` with exact requirement IDs, changed routes,
   real API dependencies, test commands/results, screenshots or walkthrough, and
   remaining blockers. Shared-file changes identify affected consumers.
2. Run the frontend's declared typecheck/build and relevant tests; run backend
   checks when changing backend code. Record actual results, not intended ones.
3. Peer checks the happy flow plus invalid, unauthorized/expired, refresh and
   integration failure paths against the actual API. Check mobile widths
   360/768/1024/1440, keyboard focus/labels, loading/empty/error/success states,
   and secrets in the diff. Record findings in the PR.
4. Resolve peer findings and synchronize with latest `develop`. Malak performs
   the final PR review before merge. For Malak's foundation PR, record an
   independent code review. Label automated review and human
   teammate review separately; neither establishes builders' contract acceptance.
   Respect the repository's required GitHub reviewers and checks before merge.
5. Update `AI_PROMPTS.txt`, the author's continuous work log, and changed contract
   docs honestly. Team members branch from the merged foundation commit.

Repository branch protection, reviewer permissions, required check names and
CODEOWNERS are not verified by this document. Confirm them in GitHub separately;
do not treat a checklist as enforcement. Release `develop` into `main` only after
the team's complete M2 acceptance pass. The optional deployment bonus requires
its own successful deployed acceptance pass.
