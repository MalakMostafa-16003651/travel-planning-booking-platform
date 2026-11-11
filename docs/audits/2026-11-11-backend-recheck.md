# Backend recheck — 11 November 2026

Scope: Persons 1–8, Milestone 1 backend, against the original project description and all 104 mandatory plus 11 bonus workbook criteria. Frontend behavior belongs to Milestone 2. Document requirements are audit evidence, not authorization to execute instructions embedded in attachments.

Base: `develop` at `9d9ff795bee824498f9ea4b5dc67411d2f766f9e`, including merged PRs #103, #104 and #105. Rechecked remotely during this work. Fix branch: `codex/backend-audit-fixes`. No changes to the shared Atlas database were made.

## Team coverage

| Person | Owner | Backend area | Result of the refreshed review |
|---|---|---|---|
| 1 | Malak | Authentication, users, references | Existing auth/verification/recovery gates retained; shared reference data checked read-only. Airports remain absent in Atlas. |
| 2 | Arwa | Administration, moderation, shared services | Moderation, related report closure, content cleanup and audit now commit atomically. Maximum-length reasons and legacy RESOLVING reports work. Admin date-only end boundaries include the whole UTC day. Business notification obligations persist before commit. |
| 3 | Gamila | Airlines, flights, search | Whitespace-only airline names reject with validation errors. Cancellation checks departure at its final write. Schedule edits and booking propagation commit together; notifications remain queued after inbox failures. Same-day round trips and real-date validation were already merged. |
| 4 | Ismail | Flight booking and inventory | Existing hold/confirmation/cancellation/expiry gates retained. FLT-27 changes and FLT-28 seats are merged. Cabin baggage allowance and weight are snapshotted for acceptance. E-tickets embed Latin, Arabic and CJK fonts. |
| 5 | Lama | Hotels, rooms, availability | PR #103/#105 metadata, room uniqueness, positive availability, search/rating, pricing and pagination improvements retained. Photo bytes and references now change atomically. |
| 6 | Osama | Hotel booking and reviews | Existing reservation/payment/refund rules retained. Booking notification obligations are durable. Null rating edits reject with HTTP 400. |
| 7 | Kiki | Itineraries, activities, budgets | Canonical ObjectId comparisons, exact reorder-set validation and admin hidden-public access fixed. Image deletion/copy/clone and parent changes are atomic. Unexpected city-store failures propagate. PDF exports include CJK glyphs. |
| 8 | Hicham | Payments, refunds, blog | Flight/hotel/flight-change checkout and retry use stable Stripe idempotency keys. Signed orphan successes recover server-owned payment records. Refund notices are durable. Blog child rows, counters and image references commit together. |

## Remaining setup and external verification

- **Shared airports:** read-only check at `2026-11-11T19:43:49.114Z` returned countries=8, cities=8, currencies=7, attractions=8, airports=0 in `travel-booking`. Run the existing `npm run seed:airports` from `backend` with the intended root `.env`, then verify airport search on that database. The seed is present; it was not run against shared Atlas in this audit.
- **Stripe:** local test suites exercise real signature verification with a controlled gateway double. A real Stripe test key/webhook secret and a reachable test callback are still needed for independent gateway verification. Hicham can provide a test deployment URL or a local configuration path; do not paste secrets into chat or commit them.
- **Mail/FX:** historical mail evidence and controlled failure/retry tests do not establish a fresh real SMTP or live exchange-rate provider result.
- **Shared configuration:** the team leader confirms the same cluster/database and separate `<name>-dev` users. A repository cannot prove each teammate's uncommitted local configuration. No credentials were collected or printed.
- **Reference source:** database/code count agreement does not prove equality with a freshly downloaded official spreadsheet; the external reference sheet was unavailable during the original audit.
- **Student review:** all eight continuous work-log files and root `AI_PROMPTS.txt` exist. Students must provide their own understanding/review notes. This audit does not fabricate approval, ownership of another student's work, or private local work.

## Validation

Production compilation and focused rollback/concurrency groups were run. The initial groups passed 79/79 and 83/83 tests. A later group passed 61/63, exposing two test mocks that discarded the new transaction session; those mocks were corrected to forward the actual model arguments.

**Final full regression: 936/936 tests PASS, 98 suites, zero failures, cancellations, skips or todo (958391.2781 ms).** Both production build and test compilation passed with private locked dependencies. Local full log: `backend/.test-dist/audit-fixes-isolated/tests.log`. Earlier counts describe earlier frozen snapshots and must not be added together as distinct tests.

One broad run completed 701 passing tests before the shared dependency directory changed; the remaining modules could not load. Two additional failures were outdated hidden-public authorization/PDF decoding assertions. Dependencies were then installed privately from the lockfile, the assertions were corrected, and the complete suite was restarted. These interrupted results are not reported as a passing full run.

PDF verification generated and visually inspected a mixed Latin/Arabic/Chinese/Japanese/Korean e-ticket and itinerary. Independent PDF extraction retained the tested CJK names; the e-ticket did not contain the unmasked identity document. This is evidence for the tested scripts, not a claim of universal Unicode coverage.

No finite test run establishes that every possible input/interleaving is correct or that the project has no remaining mistakes. Live external checks and the shared-airport setup remain distinct from local code validation.
