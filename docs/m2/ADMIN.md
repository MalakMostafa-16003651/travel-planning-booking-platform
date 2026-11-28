# Person 2 admin pages

Owner: Arwa (Person 2). All admin pages are dynamic SSR, check the session on every request,
send guests to sign in and back, and show "Access denied" to other roles. The backend's
`RolesGuard` stays the real check.

| Route | Requirements | API |
| --- | --- | --- |
| `/admin` | Admin landing | Session only. Cards for each built section (`features/admin/admin-nav.tsx`) |
| `/admin/accounts` | ACC-14, ACC-16, ACC-07a | `GET /api/admin/accounts`, `PATCH /api/admin/accounts/:id/suspend` and `/reactivate`, `POST /api/admin/users/:userId/reset-password` |

New admin pages add themselves to `adminSections`, so the menu never links to a page that does
not exist yet.

## Accounts actions

| Account | Actions |
| --- | --- |
| Administrator | None (the backend refuses them) |
| Active user or moderator | Suspend, Reset password |
| Suspended | Reactivate, Reset password |
| Deactivated by the user (ACC-12) | Reset password only; it is not reactivated from here |

- Suspend and reactivate take an optional reason (3 to 500 characters) that goes into the audit
  log. The user gets an inbox notification. Bookings stay valid and content stays visible
  (ACC-16).
- Reset password (ACC-07a) sets a temporary password that follows the registration rule. The
  backend ends the user's sessions and requires a change at the next sign-in; Malak's
  `/account/security?required=1` screen handles that. The password is not emailed or shown
  again, and the field is cleared after success.
- Each action confirms in a dialog, blocks double submission and keeps the dialog open with the
  server message on errors. A 409 (someone else changed the account first) asks the admin to
  reload. After success the list re-reads the server.

## Landing route

`roleWorkspaces.ADMIN` in `frontend/src/config/routes.ts` (Malak's file) still points to
`/workspace/admin`. `/admin` is ready to become the admin landing page when Malak switches it
(issue #127).

## Checked

In Chromium against a sample-data stand-in for the API: landing cards, admin and deactivated
rows, suspend with a reason, reactivate, short-reason and weak-password errors without a
request, temporary password set and the field cleared, a 409 race message, traveler denied,
and no sideways scroll at 360, 768, 1024 and 1440 px. `npm run typecheck` and `npm run build`
pass. The real-backend journey (reset, then the forced change at sign-in) is pending the team
test setup and should be run together with Malak.
