# Official and team reference inputs

Added 2026-11-22 for the M2 team setup. These are byte-for-byte copies of Malak's
provided/local course files. Their content was not edited during copying.

| Repository file | Original filename | SHA-256 |
| --- | --- | --- |
| [official-requirements.xlsx](official-requirements.xlsx) | `Final_ SP1_Reviewed_Requirements.xlsx` | `c9a5a24ec472e9198a910c79c9bc79c7cad8f50a3cd7b036d71771849dec9c78` |
| [revised-project-description.pdf](revised-project-description.pdf) | `new sw project description.pdf` (14 pages) | `be97dd0731e67f1eebecce20e0b7bbf5f480f4e36592ff123decfda0585fb869` |
| [milestone-2-team-split.pdf](milestone-2-team-split.pdf) | `Milestone_2_Unified_8_Person_Split_and_Shared_Rules.pdf` (37 pages) | `56f52183643ce0befe25e2ba76a36412207b9ccf83fd8a5f4f3226ef3a6f3b2f` |

The official workbook and revised course description control acceptance criteria.
The M2 team split records ownership and shared conventions; its API shorthand
must be checked against current backend DTOs and Swagger, including the money
unit differences documented in
[ROUTES_AND_HANDOFFS.md](../m2/ROUTES_AND_HANDOFFS.md).

Before copying, extracted PDF text and workbook XML were scanned for database
URIs, Stripe/webhook keys, JWTs, private keys, GitHub tokens and common assigned
secret variables; no matches were found. Destination hashes were verified against
the originals. Credentials for Atlas, mail, Stripe and FX belong only in private
local environment configuration, never in these references or AI prompt logs.

The duplicate download named `Final_ SP1_Reviewed_Requirements (1).xlsx` has the
same SHA-256 as the official workbook copied here. No duplicate is versioned.
