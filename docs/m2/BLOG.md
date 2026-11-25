# Blog and community frontend (Hicham, Person 8)

Requirements: BLG-01 to BLG-10, BLG-12 and bonus BLG-13, plus the home story previews.
Feature folder: `frontend/src/features/blog`. Backend contract: `backend/src/blog` (controllers, DTOs, services).

## Routes and rendering

| Route | Purpose | Rendering and why |
| --- | --- | --- |
| `/blog?q=&tag=&page=` | Published posts, keyword search (BLG-09), tag filter (BLG-02, BLG-08), pages of ten | Dynamic SSR (the URL decides the content). The API read is public and cookie-free. Without `q` it is cached (tag `blog-public`, 60 s fallback); keyword searches are read fresh |
| `/blog/[id]` | Post: title, author, date, tags, images, story, attached itinerary, likes, comments | Dynamic SSR, read with the viewer's cookies and `no-store` (see below) |
| `/blog/new` | Write a post, save as draft or publish | Dynamic, private, `noindex`. Server session check: guests go to sign in and come back (ACC-10) |
| `/blog/[id]/edit` | Edit title, story, tags, status, images, itinerary; delete | Dynamic, private, `noindex`, fresh with the author's cookies |
| `/blog/mine?page=` | My posts with drafts: title, status, date, likes, comments | Dynamic, private, `noindex`, `no-store` |
| `/authors/[id]?page=&itinerariesPage=` | Name, join date, published posts, public itineraries (BLG-12) | Dynamic SSR from a public, cookie-free read, never cached |

**The cached experience (course section 9).** The plain list, tag pages and the home story previews read
`GET /api/posts` without cookies, so every response is the same for everyone and can never contain a draft, a
hidden post or a personal like. These reads are cached and tagged `blog-public`. Every change expires the tag
through the `refreshPublicBlog` Server Action (`updateTag`): an author creating, publishing, editing or
deleting a post, a like or a comment, and (once the owners wire it, see Contracts) a moderator hiding or
deleting a post or an account being deactivated. The next list read is then fresh. The 60-second
revalidation is only the fallback for a change nobody reported. Keyword searches (`q`) are free text with
endless variations, so they are read fresh instead of filling the cache. The page itself stays dynamic
because the keyword, tag and page live in the URL. The action only runs for a signed-in account, so
anonymous visitors cannot keep emptying the cache; it reads and changes nothing on the backend.

**Why the post page is not ISR.** The same URL shows an author their own draft or hidden post, and carries
the viewer's own `likedByMe`. A cached copy could show those to someone else, and a post that a moderator
hides (GEN-10) or whose author deactivates (ACC-12) must disappear on the very next request. So the page is
read on every request with the viewer's cookies and `cache: 'no-store'`. `generateMetadata` gives public
posts a title, description and Open Graph article data; drafts and hidden posts are `noindex`.

**Why the author page is not cached.** It is about one person: if they deactivate their account the backend
answers 404, and that has to apply immediately rather than after a cache period. It still sends no cookies.

Fallback bound: until Arwa's moderation and Malak's deactivation call `refreshPublicBlog`, a list card
(title, author name, excerpt) of a post hidden that way can stay in a cached list for up to 60 seconds.
Opening it always gives Not found, because the post page is fresh.

## Endpoints used

| Method and path | Used by | Notes |
| --- | --- | --- |
| `GET /api/posts?q=&tag=&page=` | `/blog`, story previews | Guests allowed. Envelope `{ items, page, pageSize: 10, total, totalPages }`. With `q` the backend orders by likes + comments, newest first on ties; the page is never re-sorted here. `q` 1-100, `tag` 1-30 characters |
| `GET /api/posts/:id` | `/blog/[id]`, `/blog/[id]/edit` | Optional auth. Adds `likedByMe` and `comments` (first page). Drafts only for the author, hidden posts for the author and admins; everyone else 404 |
| `GET /api/posts/mine?page=` | `/blog/mine` | Role USER. Drafts included |
| `POST /api/posts` | editor | Role USER. `{ title 3-150, content 1-20000, tags? (≤5, each 1-30, lowercased), status DRAFT\|PUBLISHED, itineraryId? }` |
| `PATCH /api/posts/:id` | editor | Author only (403 for others). Same fields, all optional; `itineraryId: null` detaches. Sent only when the itinerary changed |
| `DELETE /api/posts/:id` | `/blog/mine`, edit page, post page | Author only. Also deletes comments, likes and images |
| `POST /api/posts/:id/images` | editor (Lama's `MediaUploader`) | Multipart field **`image`**. JPG/PNG by content, ≤5 MB, ≤5 per post. Returns the post |
| `DELETE /api/posts/:id/images/:imageId` | editor | Returns the post |
| `GET /api/posts/:id/images/:imageId` | `<img src>` | The post's `images[].url` is already same-origin `/api/...`, so the browser loads it through the Next proxy with the viewer's cookies (a draft's images only show to its author) |
| `POST` / `DELETE /api/posts/:id/like` | `LikeButton` | Role USER, public posts only. `{ liked, likesCount }`; 409 already liked, 404 not liked |
| `GET` / `POST /api/posts/:id/comments` | `Comments` | Oldest first, pages of ten. Content 1-500 after trimming |
| `PATCH` / `DELETE /api/comments/:id` | `Comments` | Own comments only |
| `GET /api/authors/:id?page=&itinerariesPage=` | `/authors/[id]`, editor itinerary list | `{ userId, name, joinedAt, posts, itineraries }`; 404 for a deactivated author |

Not used: `GET /api/tags/:tag/posts` returns the same posts as `GET /api/posts?tag=`; the list uses one
endpoint so a tag and a keyword can be combined. `PATCH /api/posts/:id/itinerary` does the same as
`itineraryId` on the main `PATCH`; the editor saves everything in one request.

Ids are endpoint-specific: `postId`, `commentId`, `imageId`, `itineraryId`, `userId`. A deactivated or
missing author or commenter comes back as `{ userId: null, name: 'Deleted user' }` and is shown without a link.
Comments have no separate author id; "my comment" means `comment.author.userId === session.userId`.
Writing, liking and commenting are role **USER** only; other roles see a short explanation instead of a button.

## Contracts

| With | Contract | State |
| --- | --- | --- |
| Malak, home | `BlogStoryPreviews` from `@/features/blog` (file `features/blog/story-previews.tsx`). Async Server Component, props `{ limit?: number }` (default 3, at most 10): the newest published posts as cards with a "Read all stories" link and friendly empty/error states. Mount as `<HomeContent stories={<BlogStoryPreviews />} />` | Ready; not mounted (the home page is Malak's) |
| Arwa, reporting (PR #153) | Mount `<ReportAction targetType="POST" targetId={post.postId} />` beside the like button in `app/blog/[id]/page.tsx`, and `targetType="COMMENT" targetId={comment.commentId}` in `features/blog/comments.tsx`. Both places are marked with a `TODO(after PR #153)` comment. No placeholder button is shown | Waiting for PR #153 |
| Arwa, pagination (PR #152) | `features/blog/pager.tsx` (Previous/Next, "Page X of Y", page in the URL; button mode for comments) is replaced by her `Pagination` | Waiting for PR #152 |
| Kiki, itinerary picker (PR #148) | The editor's itinerary `<select>` (in `post-editor.tsx`, `useOwnPublicItineraries`) lists the author's own public itineraries from `GET /api/authors/:me`, exactly the set the backend accepts. Replace it with `ItineraryPicker({ value, onChange })` and keep sending `itineraryId` | Waiting for PR #148 |
| Kiki, public itinerary page | The attached itinerary and the author page link to `/explore/itineraries/{itineraryId}` | Route is Kiki's; these links give Not found until it is on `develop` |
| Arwa (GEN-10) and Malak (ACC-12), cache refresh | `refreshPublicBlog()` Server Action, exported from `@/features/blog` (from a Client Component import `@/features/blog/actions`). Arwa calls it after hiding or deleting a post or comment; Malak calls it just **before** sending the deactivation request, because deactivation ends the session and the action only runs for a signed-in account. It resolves to `true` when it ran | Ready; waiting for the callers. Without them the 60 s fallback applies |
| Lama, media | `MediaUploader` with `onUpload` posting field `image` to the post's endpoint and `onRemove` deleting by `imageId` | Integrated |

## Rules worth knowing

- **Drafts and hidden posts** are only rendered from what the backend returns: the author sees a "Draft" or
  "Hidden by a moderator" badge on their own post; guests get Not found. Likes and comments open only on a
  published, visible post (the backend refuses them otherwise).
- **Limits** are shown before the server refuses: title 3-150 with a counter, story up to 20,000, tags 5 x 30
  (lowercased like the backend; a pasted "nile, luxor" becomes two tags), comment 500 with a live counter.
  Server field errors (`ApiError.fields`) appear under their field. The browser suite exercises this only for
  images (the server's "Image must be a JPG or PNG file"); for the other fields the form checks the same
  limits before sending, so the server path is wired but not reached by a test.
- **Stale actions** recover: editing or deleting a comment that another tab deleted closes the editor or
  dialog, says so and reloads the comments; a Like that hits "already liked" re-reads the real count;
  deleting the only post on a later page of My posts goes back one page. One-time messages (`?saved=`,
  `?deleted=`) are removed from the URL after showing, so a reload does not repeat them.
- **Images** are added after the first save, on the edit page, because the image endpoints need the post id.
  A new post goes straight to its edit page with a "You can now add images" note.
- **Ordering** comes from the backend only. Keyword search: likes + comments, newest first on ties. Browsing:
  newest first.
- **Dates** are formatted in UTC so the server and the browser print the same day.
- **Reading measure**: the story text is limited to about 65 characters per line; images are cropped 4:3.
  List responses carry no images, so list cards are text only.

## Running the checks

From `frontend/`:

```bash
npm --prefix ../backend run build
npm run typecheck
npm run build
npx playwright test -c playwright.blog.config.ts
```

The suite starts the real Nest app on a throwaway MongoDB replica set (`scripts/blog-backend.cjs`, port 3130)
and the production Next build on 3131 (move them with `BLOG_E2E_BACKEND_PORT` and `BLOG_E2E_FRONTEND_PORT`). It never reads `.env` and never touches Atlas, mail, Stripe or FX.
Fixture controls only seed users, posts and itineraries and simulate moderation hiding and deactivation;
every journey runs through the browser, the Next proxy and the real API. If mongodb-memory-server cannot
download MongoDB, set `MONGOMS_SYSTEM_BINARY` to a local `mongod`. If Playwright's browser download is
unavailable, set `PLAYWRIGHT_CHROMIUM_PATH` to an installed Chromium (or `PLAYWRIGHT_CHANNEL=chrome`).

Covered (17 tests): guest browsing with tag filter and pages of ten, clickable tags; keyword search by title,
tag and author name with interaction ordering and "No results"; guest like/comment/write sent to sign in and
returned; draft only in My posts and not in search or its (cached) tag page, publish puts it in both;
pasted tag list split; `?saved=` removed after showing; field errors; 6th tag and 31-character tag refused,
tags edited; another user cannot edit (clear page, API 403) and an admin cannot
write; delete with confirmation and cancel; deleting the only post on page 2 returns to page 1, and
`?deleted=` is removed after showing; like once (409 on a second like, and a like from another tab re-reads
the count) and unlike; comments in order, 501 characters refused, edit and delete own, and edit/delete of a
comment deleted in another tab; comment pages of ten; PNG upload, display and removal; a GIF refused by the
uploader in the browser and a fake PNG refused by the server with its own message; attach a public itinerary, private ones not offered; author page with posts and public itineraries
only; hidden post only for its author, "Deleted user" comments, deactivated author's page and post gone;
no sideways scroll at 360, 768, 1024 and 1440 px on the list, post, author page and My posts, with a
90-character unbroken title, a 300-character unbroken word in the body, a 400-character unbroken comment and
a long itinerary title.

## Known limits

- Reporting, shared pagination and the itinerary picker wait for Arwa's and Kiki's PRs (see Contracts).
- Until Arwa and Malak call `refreshPublicBlog`, a list card can stay up to 60 seconds after moderation hiding
  or deactivation (see Rendering).
- The editor's itinerary list reads at most five pages (50) of the author's public itineraries.
- `BlogStoryPreviews` is not mounted anywhere yet, so it has no browser test of its own; it reuses the
  tested list read and card parts.
