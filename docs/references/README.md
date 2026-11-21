# Official and team reference inputs

Added 2026-11-22 for the M2 team setup. These are byte-for-byte copies of Malak's
provided/local course files. Their content was not edited during copying.

| Repository file | Original filename | SHA-256 |
| --- | --- | --- |
| [official-requirements.xlsx](official-requirements.xlsx) | `Final_ SP1_Reviewed_Requirements.xlsx` | `c9a5a24ec472e9198a910c79c9bc79c7cad8f50a3cd7b036d71771849dec9c78` |
| [revised-project-description.pdf](revised-project-description.pdf) | `new sw project description.pdf` (14 pages) | `be97dd0731e67f1eebecce20e0b7bbf5f480f4e36592ff123decfda0585fb869` |
| [milestone-2-team-split.pdf](milestone-2-team-split.pdf) | `Milestone_2_Optimized_8_Person_Split_and_Shared_Rules.pdf` (26 pages) | `e2c59982a7cbab4eb30c1d0756f0ffcf22af5829cfe97a81f24ba44c9cb280a3` |

The official workbook and revised course description control acceptance criteria.
The optimized M2 team split records ownership and shared conventions. Current
backend DTOs and Swagger establish the wire contracts, including the money
unit differences documented in
[ROUTES_AND_HANDOFFS.md](../m2/ROUTES_AND_HANDOFFS.md).

Correction on 2026-11-22: PR #125 initially copied the original 37-page attachment.
The canonical file above now contains the newer 26-page optimized split produced
in the earlier team-planning chat and confirmed by Malak as the version sent to
the team. It replaces the old assignment reference; no course document or
implementation was rewritten. The original remains in Git history.

Before copying, extracted PDF text and workbook XML were scanned for database
URIs, Stripe/webhook keys, JWTs, private keys, GitHub tokens and common assigned
secret variables; no matches were found. Destination hashes were verified against
the originals. Credentials for Atlas, mail, Stripe and FX belong only in private
local environment configuration, never in these references or AI prompt logs.

The duplicate download named `Final_ SP1_Reviewed_Requirements (1).xlsx` has the
same SHA-256 as the official workbook copied here. No duplicate is versioned.
