# GEN-09 ReportAction

Builder: Arwa (Person 2). Consumers: Osama (hotel reviews), Kiki (public itineraries) and
Hicham (blog posts and comments). The contract matches the handoff registry.

```tsx
import { ReportAction } from '@/features/reports';

<ReportAction targetType="REVIEW" targetId={review.reviewId} />
```

| Prop | Type | Notes |
| --- | --- | --- |
| `targetType` | `'POST' \| 'COMMENT' \| 'REVIEW' \| 'ITINERARY'` | API names, not the PDF's `contentType` |
| `targetId` | `string` | The item's own ID from your API |
| `onReported` | `() => void` (optional) | Called once after the report is stored |

It is a Client Component. Mount it anywhere inside the app layout (it reads the shared
session). It calls `POST /api/reports` with `{ targetType, targetId, reason }`.

## What it does

| Viewer | Behavior |
| --- | --- |
| Guest | "Report" sends them to sign in and back to the same page (ACC-10) |
| Traveler (`USER`) | Opens a dialog with a required reason, 5 to 500 characters, with a counter |
| Admin or moderator | Renders nothing. Only travelers can report (backend `@Roles(USER)`); admins moderate from `/admin` |

After sending:

| Server answer | Shown |
| --- | --- |
| 201 | "Reported. Thank you." in place of the button; `onReported` runs |
| 409 | "You already reported this …" (one report per person per item) |
| 400 | The server's reason error under the field |
| 404 | "This … is no longer available, so it can't be reported." Drafts, hidden items and private itineraries answer 404 |
| 401 | "Your session has ended. Sign in again to report." |

The dialog keeps the typed reason on errors, blocks double submission, closes with Cancel or
Escape and returns focus to the button.

## Where to mount it (consumer checklist)

- Show it only on content the viewer can see. Do not show it to the item's own author if your
  page knows the author; the backend does not block self-reports, so this is a UI choice.
- Hidden content stays visible to its author and admins only. The backend answers 404 for
  hidden or draft items, so the button explains that if it is shown on one.
- Private itineraries cannot be reported (only `PUBLIC` ones).

A development preview is at `/dev/ui/report-action` in `npm run dev` (placeholder IDs).

## Checked

In Chromium with a sample-data stand-in for the API (`next dev`): guest sign-in return, the
traveler dialog, short-reason error without a request, success, 404 and 409 messages, an
expired session, Escape and focus return, nothing for admins, and no sideways scroll at
360 px. `npm run typecheck` passes. The real-backend check with real IDs is pending the team
test setup.
