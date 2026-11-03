# Continuous student workflow log

Follow the repository-root `CONTRIBUTING.md`. Create
`docs/work-logs/<student-id>.md` once for each student, using the confirmed ID;
for example, `docs/work-logs/16003651.md`. Keep all that student's work in this
one continuous file. Do not create separate files per task or requirement.

Append dated work/session entries using the block below. An entry can cover
several related changes or requirements. When work continues, append a dated
continuation in the same file and identify the earlier entry.
Include the updated continuous log in the same PR as the corresponding work and
link the relevant entry. Preserve existing history, dates, and recorded outcomes.
Record actual actions and evidence. Exclude secrets and redact credential-bearing
commands or output.

## Log owner

| Field | Value |
| --- | --- |
| Student name | <actual name, or Not provided> |
| Student ID | <confirmed student ID> |
| Team role / module | <responsible role and module> |
| File created | <actual YYYY-MM-DD; timezone> |

## YYYY-MM-DD: Work session or continuation title

### Work and attribution

| Field | Value |
| --- | --- |
| Date and timezone | <YYYY-MM-DD; timezone> |
| Student name and ID | <actual name; actual student ID> |
| Team role / module | <responsible role and module> |
| AI tool | <tool actually used, or None - no AI was used> |
| Exact model | Not disclosed; replace only if known. |
| Work and requirement references | <work covered; related IDs or not applicable with reason> |
| Policy references | <applicable sections of CONTRIBUTING.md and project rules> |
| Working branch and starting commit | <actual branch; actual SHA or not recorded> |
| Related issue | <actual issue link, none, or not yet created> |
| Record type | <contemporaneous or retrospective> |
| Reconstruction sources | <for retrospective entries: commits, PR, messages, tool output; otherwise not applicable> |

For retrospective entries, label reconstructed information and its sources. Use
`Not recorded` or `Unverified` where evidence is missing. Do not invent an earlier
plan, date, command, approval, or human action.

### Starting state and materials inspected

- Starting state: <existing behavior, relevant files, and known problems>.
- Materials actually inspected: <requirements, policy, files, or other sources>.
- Scope and constraints: <authorized changes and relevant module boundaries>.

### Plan and authorization

- Planned steps: <brief sequence; distinguish a recorded plan from retrospective reconstruction>.
- Authorization / plan approval: **PENDING**. <Record actual status, who authorized it,
  and the instruction or evidence. Use NOT REQUIRED only where the policy permits.>
- Subsequent human direction: <confirmed feedback and resulting scope/plan changes,
  or none recorded>.

### Dated chronology of actual work

| Date / time | Actor: AI, tool, or named human | Action actually taken | Observed result / evidence |
| --- | --- | --- | --- |
| <actual time or not recorded> | <actual actor> | <action> | <result and source> |

Attribute human actions only when confirmed. An AI-generated change or suggestion
does not establish that a student reviewed or accepted it.

### Decisions and alternatives

| Decision | Alternatives considered | Reason | Decision-maker / evidence |
| --- | --- | --- | --- |
| <actual decision or pending> | <actual alternatives, or none recorded> | <reason> | <who decided and source> |

### Use of AI output

| Output / suggestion | Disposition: ACCEPTED, MODIFIED, REJECTED, PENDING | By whom | What changed and why / evidence |
| --- | --- | --- | --- |
| <specific output> | PENDING | <confirmed actor or not confirmed> | <actual reason, changes, and source> |

Important prompts belong in the repository-root `AI_PROMPTS.txt`; identify the
relevant entry here: <date, heading, or actual branch/commit URL>.

### Files changed and purpose

| File | Purpose of the change |
| --- | --- |
| <actual repository path> | <specific purpose> |

### Verification

| Command / scenario | Expected result | Observed result | PASS / FAIL / NOT RUN | Actor, date, and evidence |
| --- | --- | --- | --- | --- |
| <command or check> | <expected behavior> | Not executed. | NOT RUN | <actual execution details when available> |

Do not label a proposed command as executed or a source inspection as a passing
runtime test. Record relevant negative cases as well as successful requests.

### Failures, fixes, and retests

| Failure / limitation observed | Fix or decision | Retest and actual result |
| --- | --- | --- |
| <actual failure, or none observed> | <actual change or unresolved reason> | <actual check/result, or NOT RUN> |

### Assumptions and remaining work

- Assumptions and unresolved decisions: <state them explicitly>.
- Limitations / unverified behavior: <what the evidence does not establish>.
- Remaining work and owner: <next action and owner, if agreed>.

### Human review of this entry

- Status: **PENDING**.
- Reviewer: <actual name / identity, or not confirmed>.
- Review date: <actual date, or not confirmed>.
- Confirmed feedback / outcome: <what the human reviewed and decided>.
- Evidence: <review link or explicit confirmation; pending until available>.

Keep PENDING until human review is explicitly confirmed. AI review, automated
tests, a commit, or opening a PR does not by itself establish human approval.
Review status applies to this entry and the work actually reviewed. Approval of
an earlier entry does not approve later entries or continuations.

### Actual Git references

- Commit(s): **PENDING**; replace with actual SHA(s) when available.
- PR: **PENDING**; replace with the actual PR number / URL when available.
- Entry status: <in progress, completed with evidence, or remaining work>.
