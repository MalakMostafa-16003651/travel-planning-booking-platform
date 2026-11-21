# M2: start here for every teammate and coding assistant

One repository, one frontend, one optimized eight-person split. Continue your M1
domain in the current codebase; refresh your AI's context from these files before
it starts M2 work. Old chat context and ZIPs are history, not the current source.

## Read the same inputs

1. [Optimized M2 team split](../references/milestone-2-team-split.pdf): the **26-page**
   `Milestone_2_Optimized_8_Person_Split_and_Shared_Rules.pdf`. This supersedes the
   original 37-page unified split. Read your named section and every shared rule.
2. [Official requirements workbook](../references/official-requirements.xlsx) and
   [revised description](../references/revised-project-description.pdf): acceptance
   criteria and course deliverables.
3. [Frontend README](../../frontend/README.md): locked dependencies, local startup,
   existing components, API/session usage and tests.
4. [Routes and handoffs](ROUTES_AND_HANDOFFS.md): named shared builders, current
   component inputs, actual wire fields/units and decisions still needing agreement.
5. [Team setup/review checklist](TEAM_SETUP.md), your domain's backend contract and
   actual Swagger/DTOs. The old M1 matrix can contain historical pending notes;
   do not reopen completed work without checking the current implementation.

## Start from the merged foundation

PR #125 merged the runnable frontend/auth foundation. Pull the **latest** develop
before branching; it must include that PR or a descendant, not an older M1 checkout.
Do not recreate the app, independently upgrade dependencies, or replace the shared
API client, session provider, tokens or component system.

```bash
git fetch origin --prune
git switch develop
git pull --ff-only origin develop
git switch -c feature/<requirement-id>-<short-name>
```

Preserve local work before switching branches. Install Node 24, then run `npm ci`
in backend/ and frontend/ and follow their READMEs. Obtain environment values and
designated test accounts privately; never put credentials in prompts or commits.
Browser frontend: localhost:3001. Nest/Swagger: localhost:3000/api/docs. The frontend
uses its existing same-origin `/api` proxy, not a separate browser API origin.

## Working agreement

- Build only your named pages and shared contribution. Each shared component has
  one builder; consumers integrate it and verify their own journeys. A small
  foundation is already available; every shared widget need not be finished first.
- Confirm a producer/consumer interface before integrating it. Record the real
  request/response fields, roles, IDs, units, dates, pagination, errors, expiry and
  refresh behavior beside the code. Flag discrepancies for Malak; do not guess.
- Backend validation and authorization remain authoritative. Test a small complete
  journey against real endpoints. Fixtures help development but do not certify M2.
- Pair reviews: Malak-Arwa, Gamila-Ismail, Lama-Osama, Kiki-Hicham. Payments also
  need Ismail/Osama with Hicham. Confirm availability, then record peer findings
  before Malak's required final review. Do not merge your own work independently.
- Keep PRs focused and cite requirement IDs, actual tests, responsive screenshots,
  dependencies and blockers. Update your own work log and material AI prompt use.

## Reply to Malak with these five facts

1. Person/name and first requirement slice.
2. Current branch and develop commit pulled; repository/PR access works.
3. Frontend, backend and Swagger start locally; designated test account works.
4. Shared component you supply, its consumers and the dependency you need first.
5. Proposed peer checker and any specific blocker.

When a shared contract changes, give affected teammates the PR/commit, changed
interface and consumer action. Keep the committed handoff current; separate AI
chats do not automatically exchange updates or see one another's private history.

## AI kickoff instruction

> I am Person [number/name]. Continue my M1 domain for M2 in this existing repo.
> Read docs/m2/START_HERE.md, the optimized PDF, official workbook, revised
> description, frontend README, handoff registry and actual backend DTOs/Swagger.
> Pull the latest develop including PR #125. Inspect existing frontend components
> before coding; reuse the shared client, session, tokens and locked packages.
> Implement my assigned pages and named shared contribution in small feature PRs.
> Confirm affected producer/consumer contracts, test real backend journeys and
> report exact IDs, changed files, tests and blockers. Keep credentials out of the
> chat and never claim unrun tests or completed owner work.

## Current limits

The merged starter includes basic UI/layout and real login/session/role/password
change/logout proof. It is not all of Malak's account features or completed domain
dashboards. [Validation](VALIDATION.md) records 13 passing browser checks with
disposable local MongoDB. Human handoff/access confirmations and shared Atlas
smoke remain pending; do not turn a checklist or AI review into a claimed sign-off.
