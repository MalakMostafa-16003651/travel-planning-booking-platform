# Administration, Moderation, Notifications and Audit: shared contract

Status: **proposal, not yet agreed.** Person 2 (student 16002483) owns
`backend/src/admin`, `backend/src/notifications`, `backend/src/audit-logs` and
`backend/src/reports`. This document lists the schemas, endpoints and service
interfaces other modules integrate with, following the same pattern as the
[authentication](authentication-contract-proposal.md),
[hotel](hotel-contract-proposal.md) and
[flight booking](flight-booking-contract-proposal.md) contracts.

Sources: the project PDF (2026-11-06 revision, sections 6.1, 6.6, 6.7, 8.2 and
8.10, including the highlighted provider-deactivation endpoints), the reviewed
requirements workbook (ACC-13 to ACC-17, GEN-01, GEN-05, GEN-07, GEN-09,
GEN-10), the team naming rules, and the code already merged on `develop`.

## 1. Requirements owned by Person 2

| ID | Required behavior |
| --- | --- |
| ACC-13 | Admin creates a hotel or airline moderator (name, email, role) linked to exactly one hotel or airline, with an admin-set temporary password. The moderator must change it at first login. |
| ACC-14 | Admin views a paginated list of all accounts (name, email, role, status, registration date), searchable by name or email, filterable by role and status. |
| ACC-15 | Admin suspends/reactivates moderator accounts and, separately, deactivates/reactivates a hotel or airline. A deactivated provider is hidden from search and cannot be booked; existing Confirmed bookings stay valid. Affected parties receive an in-app notification. |
| ACC-16 | Admin suspends/reactivates registered users. Suspended users cannot log in; bookings stay valid; content stays visible unless hidden through GEN-10. |
| ACC-17 | Admin views a read-only list of all flight and hotel bookings (reference, user, provider, dates, amount, status), filterable by type, status and date range. |
| GEN-01 | In-app notifications (unread count, list, mark as read) for booking confirmation, cancellation and refund, flight schedule change, and account or provider suspension. |
| GEN-07 | Audit log of admin actions (suspensions, deletions). |
| GEN-09 | A registered user reports a post, comment, review or itinerary with a reason, at most once per item. |
| GEN-10 | Admin lists open reports and resolves each by dismissing it, hiding the content or deleting it, and can hide or delete any post, comment, review or itinerary directly. Hidden content is visible only to its author and admins. |

Not owned here: ACC-07a admin password reset is already implemented by
Person 1 (`POST /api/admin/users/:userId/reset-password`). Login rejection of
suspended accounts (ACC-04) and session invalidation are Person 1's
`AuthSessionsService`, which already rejects any account whose status is not
`ACTIVE`. Person 2 only changes `User.status`.

## 2. API

All admin routes use `@UseGuards(AuthGuard, RolesGuard)` with
`@Roles(UserRole.ADMIN)`. Every list uses page size 10 (GEN-05).

| Method | Endpoint | Requirement | Who |
| --- | --- | --- | --- |
| POST | `/api/admin/moderators` | ACC-13 | ADMIN |
| GET | `/api/admin/accounts` | ACC-14 | ADMIN |
| PATCH | `/api/admin/accounts/:id/suspend` | ACC-15, ACC-16 | ADMIN |
| PATCH | `/api/admin/accounts/:id/reactivate` | ACC-15, ACC-16 | ADMIN |
| PATCH | `/api/admin/providers/:type/:id/deactivate` | ACC-15 | ADMIN (`:type` is `airline` or `hotel`) |
| PATCH | `/api/admin/providers/:type/:id/reactivate` | ACC-15 | ADMIN |
| GET | `/api/admin/bookings` | ACC-17 | ADMIN |
| GET | `/api/admin/reports` | GEN-09, GEN-10 | ADMIN |
| PATCH | `/api/admin/reports/:id` | GEN-10 | ADMIN |
| PATCH | `/api/admin/content/:type/:id/hide` | GEN-10 | ADMIN (added: direct hiding is required but not in the PDF table) |
| PATCH | `/api/admin/content/:type/:id/unhide` | GEN-10 | ADMIN (added: reverses a mistaken hide) |
| DELETE | `/api/admin/content/:type/:id` | GEN-10 | ADMIN |
| GET | `/api/admin/audit-logs` | GEN-07 | ADMIN |
| POST | `/api/reports` | GEN-09 | USER (added: supporting service, PDF section 8.10) |
| GET | `/api/notifications` | GEN-01 | any logged-in role, own only |
| GET | `/api/notifications/unread-count` | GEN-01 | any logged-in role, own only |
| PATCH | `/api/notifications/:id/read` | GEN-01 | any logged-in role, own only |
| PATCH | `/api/notifications/read-all` | GEN-01 | any logged-in role, own only |

Content `:type` values: `post`, `comment`, `review`, `itinerary`.

Rules:
- Suspend/reactivate never targets an `ADMIN` account (400). Suspending an
  already suspended account, or reactivating an active one, returns 409.
  `DEACTIVATED` accounts (ACC-12, user's own choice) are not reactivated by
  this endpoint.
- Resolving a report with `HIDE` or `DELETE` also closes every other open
  report on the same item. `DISMISS` closes only that report.
- `PATCH /api/admin/reports/:id` body: `{ "action": "DISMISS" | "HIDE" | "DELETE" }`.

## 3. Schemas (Person 2)

### ModeratorAssignment (`moderatorassignments`)

The collection name and field names are **already read** by
`AirlinesService.getAssignedAirlineId` and `HotelsService.getAssignedHotelId`.
They must not change.

| Field | Meaning |
| --- | --- |
| `_id`, `createdAt`, `updatedAt` | Standard. |
| `moderatorId` | ObjectId of the moderator `User`. Unique: one assignment per moderator. |
| `airlineId` | ObjectId of an `Airline`. Present only for `AIRLINE_MODERATOR`. |
| `hotelId` | ObjectId of a `Hotel`. Present only for `HOTEL_MODERATOR`. |

Exactly one of `airlineId` / `hotelId` is set, matching the moderator role. A
provider may have more than one moderator. User and assignment are created in
one MongoDB transaction so a moderator never exists without an assignment.

### AuditLog (`auditlogs`)

Append-only. No update or delete endpoint.

| Field | Meaning |
| --- | --- |
| `adminId` | ObjectId of the admin who acted. |
| `action` | `MODERATOR_CREATED`, `PASSWORD_RESET`, `ACCOUNT_SUSPENDED`, `ACCOUNT_REACTIVATED`, `PROVIDER_DEACTIVATED`, `PROVIDER_REACTIVATED`, `CONTENT_HIDDEN`, `CONTENT_UNHIDDEN`, `CONTENT_DELETED`, `REPORT_DISMISSED`. |
| `targetType` | `USER`, `AIRLINE`, `HOTEL`, `POST`, `COMMENT`, `REVIEW`, `ITINERARY`, `REPORT`. |
| `targetId` | ObjectId of the affected record. |
| `details` | Optional short text, for example the report reason. |
| `createdAt` | When it happened. |

### Notification (`notifications`)

| Field | Meaning |
| --- | --- |
| `userId` | Recipient. |
| `type` | `BOOKING_CONFIRMED`, `BOOKING_CANCELLED`, `REFUND_ISSUED`, `FLIGHT_SCHEDULE_CHANGED`, `ACCOUNT_SUSPENDED`, `ACCOUNT_REACTIVATED`, `PROVIDER_DEACTIVATED`, `PROVIDER_REACTIVATED`. |
| `message` | Text shown to the user. |
| `isRead` | Default `false`. |
| `readAt` | Set when marked as read. |
| `createdAt` | Standard. |

Index: `{ userId: 1, isRead: 1, createdAt: -1 }`.

### Report (`reports`)

| Field | Meaning |
| --- | --- |
| `userId` | The reporting user (team ownership naming). |
| `targetType` | `POST`, `COMMENT`, `REVIEW`, `ITINERARY`. |
| `targetId` | ObjectId of the reported item. |
| `reason` | Required, 5 to 500 characters. |
| `status` | `OPEN`, `DISMISSED`, `CONTENT_HIDDEN`, `CONTENT_DELETED`. |
| `resolvedBy`, `resolvedAt` | Admin and time of resolution. |

Unique index `{ userId, targetType, targetId }` enforces "at most once per
item" (GEN-09). A duplicate report returns 409.

## 4. What Person 2 exports to other modules

### `NotificationsModule` → `NotificationsService`

```ts
notify(input: { userId: string; type: NotificationType; message: string }): Promise<void>
```

This matches Person 4's existing `BookingNotificationsPort`, so the flight
booking module can bind `BOOKING_NOTIFICATIONS` to `NotificationsService`
instead of `PendingNotificationsAdapter` without changing its service code.
Callers should treat notification failure as non-fatal, as Person 4 already
does.

Expected callers:

| Event | Caller |
| --- | --- |
| Flight booking confirmed / cancelled | Person 4 (port already exists) |
| Hotel reservation confirmed / cancelled | Person 6 |
| Refund issued | Person 8 |
| Flight schedule changed / flight cancelled | Person 3 |
| Account suspended / reactivated, provider deactivated / reactivated | Person 2 |

### `AuditLogsModule` → `AuditLogsService`

```ts
log(input: { adminId: string; action: AuditAction; targetType: AuditTargetType; targetId: string; details?: string }): Promise<void>
```

Used inside Person 2's admin services. Exported in case another module adds an
admin action later.

## 5. What Person 2 needs from other modules

| Owner | Needed | Status |
| --- | --- | --- |
| Person 1 | `AuthGuard`, `RolesGuard`, `@Roles`, `User` schema | Merged and exported |
| Person 1 | `PasswordService` (salted scrypt hashing) for the moderator's temporary password, so passwords are hashed one way across the project | Exported from `AuthModule` in the integration review branch; available after its PR is merged |
| Persons 3 and 5 | `Airline.isActive` / `Hotel.isActive` enforced in search, detail and booking | Merged |
| Person 4 | `FlightBookingsService.listForAdmin({ status, from, to, page })` for ACC-17 | Merged and exported; reused, not duplicated |
| Person 4 | A method returning the `userId`s with `CONFIRMED` bookings on a given airline (for example `listConfirmedUserIdsForAirline(airlineId)`), for ACC-15 notifications | **Pending**: to be requested |
| Person 8 | `BlogService.setPostHidden`, `adminDeletePost`, `postExists`; `CommentsService.setCommentHidden`, `adminDeleteComment`, `commentExists` | Merged and exported |
| Person 6 | Hotel booking collection and field names for ACC-17; `isHidden` on `Review` plus `setReviewHidden`, `adminDeleteReview`, `reviewExists` | **Pending**: not yet merged |
| Person 7 | `isHidden` on `Itinerary`, excluded from public search/view except for author and admins; `setItineraryHidden`, `adminDeleteItinerary`, `itineraryExists` | **Pending**: not yet requested |

Until the pending items are merged, reports and moderation support `post` and
`comment`; `review` and `itinerary` return 400 "not yet supported", and the
bookings list returns flight bookings only.

## 6. Provider deactivation flow (ACC-15)

1. Load the airline or hotel; 404 if it does not exist; 409 if already in the
   requested state.
2. Set `isActive` to `false` (or `true` to reactivate).
3. Notify every moderator assigned to it (`moderatorassignments`).
4. Notify every user with a `CONFIRMED` booking with that provider that their
   booking remains valid.
5. Write an audit log entry.

Steps 3 to 5 run after step 2 is saved; a notification failure does not undo
the deactivation.

## 7. Open questions for the team

1. Person 1: can `AuthModule` export `PasswordService` so moderator creation
   reuses the same hashing instead of duplicating it?
2. Person 4: will you swap `PendingNotificationsAdapter` for
   `NotificationsService`, or should Person 2 do it in the notifications PR with
   your approval? Could you also add `listConfirmedUserIdsForAirline(airlineId)`
   to `FlightBookingsService` for ACC-15 notifications?
3. Person 6: collection and field names for hotel bookings; `isHidden` on
   reviews.
4. Person 7: `isHidden` on itineraries and the three exported methods.


## Approved transaction integration - 2026-11-10 (pending PR review)

Malak authorized Person1 plus related Person2 repairs and explicitly approved AuditAction.PASSWORD_RESET and optional ClientSession arguments on AuditLogsService.log, NotificationsService.notify/notifyMany and UsersService.setTemporaryPassword. Existing callers may omit the session. Auth imports AuditLogsPersistenceModule (writer/schema plus UsersModule only); the guarded AuditLogsModule imports/re-exports it, preserving one shared AuditLogsService without an Auth-to-audit-controller cycle. No new collection, User field, environment name or request input.

- POST /api/admin/users/:userId/reset-password obtains adminId only from the authenticated guard. Password/credential epoch and the PASSWORD_RESET audit share one transaction. Audit fields are adminId, action, targetType USER and targetId; no password, hash, token or request-body details. Failure rolls back the reset and leaves prior sessions/credentials usable. Successful reset retains all existing restrictions/invalidation.
- Account suspension/reactivation and provider activation/deactivation commit their state, audit and stored inbox notifications together. Required database failure returns the existing generic500 and rolls all those writes back; retry can succeed. This intentionally replaces their earlier best-effort notification boundary. Other booking/payment callers retain their existing policy. Use sequential operations with one MongoDB session, not Promise.all inside the transaction.
- Moderator creation includes MODERATOR_CREATED in its existing account/assignment transaction; audit failure no longer leaves an unrepeatable account collision.
- Hotel deactivation calls HotelBookingsService.releasePendingHoldsForHotel after commit, preserving confirmed stays and reusing existing expiry/payment reconciliation. Cleanup failure is logged and natural hold expiry remains fallback; it does not cause a false failed-provider response after commit. Arwa and Osama still need provider/hold ordering to prevent a later hold escaping the one cleanup query. Lama still needs roomHasActiveReservations with conflict-producing writes.

The report/content moderation owner methods remain outside the caller's transaction and are not certified atomic by this integration. Do not claim this patch fixes every GEN-07 producer. Handoff: Arwa should reuse these exports and pass the existing transaction session rather than invent another audit writer or duplicate enum. Personal AI log updates remain each student's responsibility; this work is credited in Malak16003651 only.


## GEN-01-B approved durable email outbox (2026-11-10)

Malak approved one private `NotificationEmailJob` collection and the narrow moderator-invitation hook. Public Notification fields/types and caller interfaces stay unchanged. Email jobs store `userId`, optional `notificationId`, `kind` (NOTIFICATION or MODERATOR_INVITATION), existing `notificationType`, message, unique dedupeKey, private delivery status (PENDING/PROCESSING/SENT/FAILED), attempts, availableAt, leaseUntil/leaseToken, sentAt, lastFailureAt and normal timestamps. These delivery enums are private and do not replace shared booking/payment/account enums.

NotificationsService stores inbox and outbox together using the existing optional ClientSession; without one it opens a local transaction. AdminModeratorsService enqueues the invitation before its account/assignment/audit transaction commits. Other domain owners keep their current producers. The separate worker uses the shared MailService after commit, one job per 15-second tick, leased claims and five bounded attempts. SMTP unset leaves jobs pending. Outbox failure rolls the required database action back; later SMTP failure only changes delivery retry state. No raw temporary password or reset proof is included in an invitation, job, log or API response. Existing SMTP names are reused; there is no new endpoint or secret setting.

Consumers should continue using NotificationsService, not writing the private collection or sending a second email themselves. SMTP acceptance plus a lost acknowledgement can cause a duplicate (at-least-once delivery), while normal concurrent workers are fenced by per-job leases. Jobs whose recipient account no longer exists terminate without sending to another address. Suspended-account notices still reach their account email. Failed jobs remain for operator review rather than retrying forever.
