# Team development workflow

This is the central contribution policy. The official requirements workbook
defines functional acceptance criteria; the project description defines the
architecture, milestones, and mandatory AI prompt log. Task-specific user
instructions and agreed module interfaces determine the authorized scope.

## One reviewable task at a time

Before implementation, identify the requirement IDs or policy source, inspect the
existing code and conventions, explain the plan, and resolve missing shared
decisions with the affected owners. Keep proposed decisions distinct from
decisions the student actually approved. A direct instruction to implement a
defined task authorizes that scope; unrelated work still needs authorization.

Controllers handle HTTP, services handle business logic, and the agreed model or
data-access layer handles persistence. Reuse shared logic. Do not change another
person's module, shared fields/enums/interfaces, or environment-variable names
without coordination. Consult the
[accepted account contract](docs/requirements/authentication-contract-proposal.md)
when a task concerns Authentication and Users.

## Git and branch synchronization

1. Before changes, verify the repository root, expected remote, current branch,
   and working-tree status. Preserve uncommitted and unrelated work. Do not
   automatically reset, stash, discard, or overwrite it.
2. Fetch current remote refs at the start of each development task. Keep local
   `main` synchronized with `origin/main` using a fast-forward-only update. Check
   for divergence; report it instead of forcing an update. Avoid changing the
   checked-out files just to refresh a branch ref.
3. `main` contains stable milestone releases. Keeping it current means matching
   GitHub's `main`; promoting `develop` requires a separate, reviewed release PR.
4. Start authorized work from the latest `origin/develop` on a short-lived
   branch. Do not implement on `main` or `develop`. Use:
   `feature/<requirement-id>-<description>`, `fix/<requirement-id>-<description>`,
   `docs/<description>`, or `refactor/<description>`.
5. Synchronize regularly. Before opening a PR, fetch again and merge updated
   `develop` into the task branch. Resolve conflicts without removing teammates'
   work. Do not rewrite published history or force-push, including
   `--force-with-lease`.
6. Review the full intended diff, stage only intended files, and use a meaningful
   conventional commit such as `feat(auth): implement login` or
   `docs(workflow): add team task logging`.
7. Push the task branch and open a focused PR into `develop`. The responsible
   student reviews and understands their work; the team leader reviews the PR.
   Record the confirmed reviewer. An AI must not merge automatically: merge only
   after explicit human review/approval authorizes it.

If a fetch or other operation fails, record the real failure. Do not claim that
refs are current or an operation succeeded until verified. Retry or use reliable
evidence to check the state, and hold dependent edits when the base is uncertain.

## One continuous workflow log per student

Each student maintains one continuous file for the whole project:
`docs/work-logs/<student-id>.md`. Initialize it once from
[TEMPLATE.md](docs/work-logs/TEMPLATE.md) using the student's confirmed ID. For
Person 1, the file is `docs/work-logs/16003651.md`. Do not guess identities or
overwrite another student's history.

Append dated entries and continuations as work progresses. An entry may describe
a work session or a coherent group of related changes; requirement IDs are
references within entries, not reasons to create more files. Do not create
separate log files for tasks, requirements, days, or PRs.

Every feature or fix PR updates its responsible student's existing log and links
the relevant dated entry. Meaningful documentation work follows the same rule.
If several students contribute, link each contributor's continuous log and entry.
Each student owns the accuracy of their log even when AI helps draft it. Preserve
earlier entries and results; append dated corrections rather than replacing
history. Keep human-review status scoped to each entry and its actual changes.

At the planning, implementation, verification, and review checkpoints, record:

- Date, student, task, requirement IDs or policy source, branch, and issue if one
  exists; AI tool and model if known, or explicitly state that no AI was used.
- Starting state, relevant requirements, and materials actually inspected.
- The proposed plan, its authorization status, and the evidence for any approval.
- A chronological summary of observable actions, distinguishing student and AI
  contributions.
- Decisions, alternatives, short reasons, and who decided; AI suggestions accepted,
  modified, or rejected, including by whom and why.
- Files changed and their purposes.
- Checks or manual scenarios, expected behavior, observed results, and
  `PASS`, `FAIL`, or `NOT RUN` for each. Include failed attempts, corrections,
  and retest results.
- Remaining problems, assumptions, required checks, actual Git references when
  available, and human-review status and reviewer when confirmed.

Record summaries and concise reasons, not private internal reasoning. Never
fabricate tests, timestamps, approvals, contributions, model names, commits, PRs,
or results. Use `Not disclosed`, `Not provided`, `None`, or `Not yet created` when
appropriate rather than filling gaps with guesses.

Each entry's final human review starts as `PENDING`. Implementation authorization,
an AI review, a passing test suite, and the student's final review are separate facts.
Mark human review confirmed only when the student explicitly confirms it, with
the actual reviewer and evidence. Review readiness is not final approval.

When reconstructing older work, label the entry `RETROSPECTIVE`, state the record
creation date, and identify the evidence used. Do not backdate the record or
invent missing history. This setup does not retroactively assert that earlier
merged PRs had workflow records.

## AI_PROMPTS.txt

Keep the course-required root file and preserve its existing history. Append the
important sanitized prompts that materially contributed to a task, how the output
was actually used, requirement IDs or policy references, and the student's
continuous-log path and relevant entry date. Multi-turn work can use a short
chronological summary with key excerpts.

Use dated student-log entries for the detailed process and `AI_PROMPTS.txt` for
the important prompts and their use. Link the two instead of copying the whole
workflow into both files. If work uses no AI, state that in the corresponding
student-log entry rather than inventing prompts.

## Verification, privacy, and shared data

Choose checks appropriate to the change. Backend features normally require build,
validation, behavior, authorization/ownership checks, database behavior, and
Swagger coverage where relevant. Documentation-only work requires link and
consistency checks, preserved history, and diff review; record backend tests as
`NOT RUN` with the reason when code/configuration is unchanged.

Do not put credentials, connection strings, passwords, password hashes, cookies,
tokens, or private user data into logs, prompt entries, screenshots, command
output, or commits. Describe sensitive diagnostics with sanitized outcomes. Do
not ask a student to paste secrets. Keep secrets in ignored `.env` files and only
safe variable names/placeholders in `.env.example`.

Prefer an isolated local test database. If shared Atlas data must be used, agree
on isolated test records and cleanup with the affected owners. Never wipe shared
collections or modify another student's data.

## Ready for review

The [PR template](.github/pull_request_template.md) asks for the requirement or
policy reference, change/design summary, actual checks and limitations, work-log
links, AI attribution, and human-review status. Complete it truthfully.

A task is ready for review when its agreed behavior is implemented, appropriate
checks have been performed and limitations disclosed, Swagger is current where
needed, the diff is scoped and free of secrets, and the student-log entry and
important prompt entries are current. The student must be able to explain the implementation
and its decisions during evaluation.

These are documented contribution and review requirements. This setup does not
add an automated CI enforcement gate.

GitHub makes PR templates automatically available after they reach the
repository's default branch. Until then, copy the template from `develop` or the
task branch when preparing a PR. This documentation change does not alter the
default branch or promote `develop` to `main`. See
[GitHub's template guidance](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository).
