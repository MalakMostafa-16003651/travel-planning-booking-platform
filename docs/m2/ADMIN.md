# Person 2 admin pages

Owner: Arwa (Person 2). All admin pages are dynamic SSR, check the session on every request,
send guests to sign in and back, and show "Access denied" to other roles. The backend's
`RolesGuard` stays the real check.

| Route | Requirements | API |
| --- | --- | --- |
| `/admin` | Admin landing | Session only. Cards for each built section (`features/admin/admin-nav.tsx`) |
| `/admin/accounts` | ACC-14, ACC-16, ACC-07a | `GET /api/admin/accounts`, `PATCH /api/admin/accounts/:id/suspend` and `/reactivate`, `POST /api/admin/users/:userId/reset-password` |
| `/admin/reports` | GEN-09, GEN-10 | `GET /api/admin/reports?page=&status=&targetType=`, `PATCH /api/admin/reports/:id` `{ action }` |
| `/admin/content` | GEN-10 | `PATCH /api/admin/content/:type/:id/hide` and `/unhide`, `DELETE /api/admin/content/:type/:id` |
| `/admin/bookings` | ACC-17 | `GET /api/admin/bookings?page=&type=&status=&from=&to=` (read-only) |
| `/admin/audit-logs` | GEN-07 | `GET /api/admin/audit-logs?page=&action=&targetType=&from=&to=` (read-only) |

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

## Reports and content (GEN-09, GEN-10)

- `/admin/reports` lists open reports by default (the backend's default), newest first, ten per
  page, with the reporter's name. Filters: status (open, being resolved, dismissed, content hidden,
  content deleted) and content type, kept in the URL.
- Open reports have **Dismiss** (closes only that report), **Hide** and **Delete** (act on the
  content and close every open report about it). Each confirms in a dialog; delete explains that
  related data goes too. A 409 says another admin resolved it first. Closed reports show "Closed".
- **Moderate directly** opens `/admin/content` with the type and ID filled in.
- `/admin/content` hides, unhides or deletes any post, comment, review or public itinerary, with
  or without a report. The ID is checked before sending; Enter does nothing, so nothing happens
  without a click; delete asks again. 404 explains that the ID or type is wrong or that the
  itinerary is private (private itineraries are never moderated, ACC-11).
- Content preview links: the registry says content owners supply permitted navigation
  (Hicham `/blog/[id]`, Kiki `/explore/itineraries/[id]`, Osama reviews). The list shows the type
  and ID until those routes are agreed; no links are guessed.

## Bookings and audit log (ACC-17, GEN-07)

- `/admin/bookings` lists flights and hotels together (one total, newest first) unless a type is
  chosen. Columns: reference ("No reference yet" before confirmation), Flight/Hotel, traveler
  name and email, airline or hotel, travel dates, total and status. No passenger details, as the
  backend promises.
- `totalAmount` is integer minor units (the registry's amount table), shown with
  `formatMoneyMinorUnits(totalAmount, currency)`: `15050` is $150.50.
- `/admin/audit-logs` shows only what the backend recorded (append-only): time (UTC), action,
  administrator, record type and ID, and details. Filters: action, record type and dates. Nothing
  on the page creates audit entries.
- Date filters are calendar days in the URL (`?from=2026-12-01&to=2026-12-31`) and are sent as the
  whole UTC day (`T00:00:00.000Z` to `T23:59:59.999Z`). A "from" after "to" is caught before any
  request. The shared `FilterDate` and `dateParam` helpers were added for this.

## Moderators and providers

`/admin/moderators` and `/admin/providers` wait for issue #156: the backend has no admin list of
airlines and hotels to choose from.

## Landing route

`roleWorkspaces.ADMIN` in `frontend/src/config/routes.ts` (Malak's file) still points to
`/workspace/admin`. `/admin` is ready to become the admin landing page when Malak switches it
(issue #127).

## Checked

Bookings and audit log, in Chromium with sample data: ten of fourteen bookings, cents shown as
dollars, pending booking without a reference, type and date filters sent as whole UTC days, a
reversed date range caught, status filter, audit filter and empty state, menu with all six
sections, travelers denied, no sideways scroll at 360, 768, 1024 and 1440 px.


Reports and content, in Chromium with sample data: ten open reports per page, dismiss, hide
(both reports about the item close), the status filter and its empty state, the prefilled
content form, Enter does nothing, an invalid ID and a 404, unhide, delete with confirmation,
travelers denied, no sideways scroll at 360 and 768 px.

Accounts:

In Chromium against a sample-data stand-in for the API: landing cards, admin and deactivated
rows, suspend with a reason, reactivate, short-reason and weak-password errors without a
request, temporary password set and the field cleared, a 409 race message, traveler denied,
and no sideways scroll at 360, 768, 1024 and 1440 px. `npm run typecheck` and `npm run build`
pass. The real-backend journey (reset, then the forced change at sign-in) is pending the team
test setup and should be run together with Malak.
