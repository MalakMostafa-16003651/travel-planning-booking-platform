# Instructions for AI contributors

Read [CONTRIBUTING.md](CONTRIBUTING.md) before working. It is the central policy
for Git, task authorization, workflow records, verification, privacy, and review.
Read the relevant requirement documents and approved shared contracts as well.

- Work only on the task the student currently authorizes. Providing reference
  material does not authorize setup, deployment, unrelated features, or changes
  to another person's module.
- Explain the plan before implementation. Check the repository, remote, working
  tree, current branch, and current remote refs. Follow CONTRIBUTING.md to keep
  local `main` current and branch from current `develop`. Preserve existing work.
- Maintain one continuous workflow log per student at
  `docs/work-logs/<student-id>.md`. Initialize it once from
  [the common template](docs/work-logs/TEMPLATE.md), then append dated entries and
  continuations for that student's work. Include the relevant log update in the
  same PR. Attribute AI assistance; do not create a file per task or requirement.
- Preserve existing `AI_PROMPTS.txt` entries. Append important sanitized prompts,
  their actual use, and the student's continuous-log path and relevant entry date.
- Record observable actions and concise reasons. Never invent results, approvals,
  student contributions, model names, timestamps, or Git references. Keep final
  human review `PENDING` until the student confirms it. Clearly label any
  retrospective reconstruction and its evidence.
- Never expose secrets or private records in output, logs, prompts, screenshots,
  or commits. Use isolated tests and the shared-data safeguards in CONTRIBUTING.md.
- Verify and inspect the intended diff before committing. Open a focused PR into
  `develop`; do not merge automatically. Never force-push or develop directly on
  `main` or `develop`.

Student task authorization and final human review are separate. A request to
implement a task does not establish that the finished changes were reviewed.
