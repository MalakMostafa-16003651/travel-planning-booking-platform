# GEN-01 NotificationBell and /notifications

Builder: Arwa (Person 2). Host: Malak's header `notificationSlot` (registry: "Arwa owns
count/list/read state and mounts one bell in the slot").

## Bell

`<NotificationBell />` from `@/features/notifications`, no props, mounted once in
`frontend/src/app/layout.tsx`:

```tsx
<AppHeader notificationSlot={<NotificationBell />} accountSlot={<HeaderAccount />} />
```

- Shown to every signed-in role, hidden for guests (it reads the shared session).
- Links to `/notifications`. Its accessible name includes the count ("Notifications, 3 unread");
  the badge shows up to "99+".
- Reads `GET /api/notifications/unread-count` on sign-in, on every navigation, when the window
  regains focus and after the inbox changes. There is deliberately no timer: the README forbids
  polling that silently keeps an idle session alive.
- The count is stored with the `userId` it belongs to and shown only while that user is signed in.
  After an account switch (for example another sign-in in a second tab) the old count disappears
  at once, even if the new account's request is slow or fails; a late answer for an earlier request
  is ignored.
- Anything that changes the inbox in the browser can refresh it with
  `window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED))`.

## Inbox page

`/notifications`, dynamic SSR, private and never cached. Guests sign in and return.

| API | Used for |
| --- | --- |
| `GET /api/notifications?page=&unreadOnly=true` | Ten per page, newest first; `unreadCount` covers the whole inbox |
| `PATCH /api/notifications/:id/read` | "Mark as read" on one item |
| `PATCH /api/notifications/read-all` | "Mark all as read" |

The URL keeps the page and the filter (`?show=unread&page=2`). Each item shows its type, the
server's message and the time in the viewer's time zone. After a change the page re-reads the
server and the bell updates. Empty, all-caught-up, past-the-end and load-error states are
covered.

## Deep links

`NotificationDto` has no target ID or link (`notificationId`, `type`, `message`, `isRead`,
`readAt`, `createdAt`). Following the registry ("do not invent links from message text"), items
are not clickable. If an event owner adds a target field to the backend, the inbox can link it
after that change is agreed.

## Checked

Account switch (review on #154): signed in with 4 unread, switched to an account whose count
request fails: the badge cleared while the request was pending and stayed clear after it failed;
switching back showed 4 again; switching to an account with 0 unread showed no badge. The same
check on the previous code kept "4 unread" for the second account.


In Chromium against a sample-data stand-in for the API (`next build` + `next start`): bell count
and accessible name, opening the inbox, ten per page and page 2, mark one and mark all (bell
updates without reload), the Unread filter and its empty state, past-the-end page, bell for an
admin, no bell for a guest, guest sign-in return to `/notifications?show=unread`, and no sideways
scroll at 360 px. `npm run typecheck` and `npm run build` pass. The real-backend check is
pending the team test setup.
