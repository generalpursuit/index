# Index API

The API uses feature-local contracts, Zod schemas, routers with inline handlers, services, and repositories. Services return `neverthrow` results. Repositories own database queries, including joins across tables. Authorization predicates live in `packages/api/src/data-access/visibility.ts` and are applied before pagination.

## Transports and authentication

- Typed oRPC: `/rpc/v1` (`/rpc` remains an alias). Import `AppRouterClient` from `@index/api/contracts`.
- REST: `/api/v1`; OpenAPI: `/api/v1/openapi.json`; reference: `/api/v1/docs`.
- Better Auth: `/api/auth`; its OpenAPI document: `/api/auth/open-api/generate-schema`.
- Browser clients use Better Auth's secure HttpOnly session cookie and `credentials: "include"`.
- Native clients sign up at `POST /api/auth/sign-up/email` with `{ name, username, email, password }`, or sign in at `POST /api/auth/sign-in/email` with `{ email, password }` or `POST /api/auth/sign-in/username` with `{ username, password }`. `POST /api/auth/is-username-available` with `{ username }` checks a username before sign-up.
- Native clients must retain the **signed `set-auth-token` response header**, then send `Authorization: Bearer <token>` to both APIs. The unsigned token in the JSON response is not accepted as a bearer credential.
- Restore a native session with `GET /api/auth/get-session`; log out with `POST /api/auth/sign-out`. Replace a stored token if a later response supplies `set-auth-token`. Store it in the platform's secure credential store (Keychain on iOS), share it with an extension only through a deliberately configured shared Keychain group, and erase it on logout or session expiry. The native clients and real Share extension targets use the [shared Keychain contract](sharing.md#secure-hostextension-session-boundary).

Better Auth continues to own login, credentials and sessions. Its routes are not reimplemented in oRPC. The two OpenAPI documents describe the application and authentication surfaces respectively. See [Better Auth bearer integration](https://better-auth.com/docs/plugins/bearer) and [authentication OpenAPI](https://better-auth.com/docs/plugins/open-api).

## Application endpoints

Paths below are relative to `/api/v1`. All mutations require authentication. Public reads accept optional credentials and return only content visible to that viewer. Missing and inaccessible resources both return 404.

| Procedure                   | HTTP                                       | Behavior                                                                                                       |
| --------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `routes.resolve`            | GET `/routes/resolve`                      | Resolve canonical/legacy readable paths after checking viewer access; see [route contract](readable-routes.md) |
| `profiles.me`               | GET `/me/profile`                          | Current user's profile; authenticated                                                                          |
| `profiles.update`           | PATCH `/me/profile`                        | Edit name, username and profile visibility; `image: null` removes the photo                                    |
| `profiles.uploadImage`      | POST `/me/image`                           | Upload a profile photo (multipart `image`, JPEG/PNG/WebP, at most 5 MB); replaces the current one              |
| `profiles.get`              | GET `/profiles/{userId}`                   | Public identity, viewer access, private counts and social context                                              |
| `profiles.byUsername`       | GET `/profiles/by-username/{username}`     | Look up a normalized username                                                                                  |
| `groups.create`             | POST `/groups`                             | Create an owned custom group; defaults to public                                                               |
| `groups.list`               | GET `/groups`                              | Visible groups, including Starred and Favorites, each with the `linkCount` the viewer may see                  |
| `groups.get`                | GET `/groups/{id}`                         | Get a visible group                                                                                            |
| `groups.update`             | PATCH `/groups/{id}`                       | Change an owned group's name or visibility                                                                     |
| `groups.delete`             | DELETE `/groups/{id}`                      | Keep its links outside any group; JSON body `{ deleteLinks: true }` deletes them instead                       |
| `links.share`              | POST `/links/share`                        | Duplicate-aware current-week save with an account/payload-bound retry ID; see [sharing](sharing.md) |
| `links.create`              | POST `/links`                              | Save a link, optionally into an owned custom `groupId`; `title` is read from the page if omitted               |
| `links.listMine`            | GET `/links`                               | Owned links; optional `groupId` and `category` filters; authenticated                                          |
| `links.get`                 | GET `/links/{id}`                          | Get a visible original link                                                                                    |
| `links.update`              | PATCH `/links/{id}`                        | Edit an owned link or move it; `groupId: null` takes it out of its group                                       |
| `links.delete`              | DELETE `/links/{id}`                       | Delete an owned link and cascade its stars, favorites and comments                                             |
| `links.listInGroup`         | GET `/groups/{groupId}/links`              | Visible originals in a custom, Starred or Favorites group, each with its owner's `ownerName`                   |
| `follows.follow`            | POST `/profiles/{userId}/follow`           | Follow a public profile or request a private profile                                                           |
| `follows.unfollow`          | DELETE `/profiles/{userId}/follow`         | Unfollow or cancel a pending request                                                                           |
| `follows.followers`         | GET `/profiles/{userId}/followers`         | Own accepted followers; other users receive 404                                                                |
| `follows.following`         | GET `/profiles/{userId}/following`         | Own accepted followees; optional literal `query` for recipient search                                          |
| `follows.requests`          | GET `/me/follow-requests`                  | Pending incoming requests; authenticated                                                                       |
| `follows.accept`            | POST `/me/follow-requests/{userId}/accept` | Accept an incoming request                                                                                     |
| `follows.reject`            | DELETE `/me/follow-requests/{userId}`      | Remove a pending incoming request                                                                              |
| `follows.removeFollower`    | DELETE `/me/followers/{userId}`            | Remove an incoming relationship                                                                                |
| `stars.add`                 | PUT `/links/{linkId}/star`                 | Star another person's visible original link                                                                    |
| `stars.remove`              | DELETE `/links/{linkId}/star`              | Remove own star, even if the original is now inaccessible                                                      |
| `stars.group`               | GET `/me/starred/group`                    | Get/create own Starred group; authenticated                                                                    |
| `stars.list`                | GET `/me/starred`                          | Accessible originals in own Starred group; authenticated                                                       |
| `comments.create`           | POST `/links/{linkId}/comments`            | Add a flat text comment to an accessible link                                                                  |
| `comments.list`             | GET `/links/{linkId}/comments`             | Visible comments with public author identity                                                                   |
| `comments.update`           | PATCH `/comments/{id}`                     | Edit own comment while the link is accessible                                                                  |
| `comments.delete`           | DELETE `/comments/{id}`                    | Delete own comment, or moderate a comment on an owned link                                                     |
| `feed.weeks`                | GET `/feed/weeks`                          | Weeks with links from you or accepted follows, newest first, with counts; authenticated                        |
| `feed.list`                 | GET `/feed`                                | Newest accessible original saves from accepted followees; authenticated                                        |
| `discovery.searchUsers`     | GET `/discovery/users`                     | Search public names/usernames using `query`                                                                    |
| `discovery.recommendations` | GET `/discovery/recommendations`           | Second-degree suggestions; authenticated                                                                       |

`/health` reports server status.

## Visibility and interaction rules

- A link without a group (`links.groupId = null`) follows its owner's profile visibility. Only locked groups hide links further. Deleting a locked group while keeping its links therefore exposes them to anyone who can see the profile; clients must say so before confirming.
- A private group is always owner-only, including under a private profile with accepted followers. The UI calls this **Locked**; **Unlocked** maps to public. The stored/API values remain `private` and `public`.
- A public group under a public profile is available anonymously. A public group under a private profile is available to its owner and accepted followers.
- Basic profile identity (ID, name, username, image and visibility) remains discoverable for private profiles. Email and authentication fields are excluded. Follower and following lists are owner-only for every profile. Their counts are null for other viewers. Other private profiles also return a null link count; public profiles count only accessible originals.
- Profiles include `followedBy: { users, total }`: at most two of the viewer's accepted followees who also follow that profile, plus their total. This supports “Followed by…” without exposing the profile's follower count.
- Profile photos are only uploaded, never set as an address: `profiles.uploadImage` reads the file's type from its first bytes (JPEG, PNG or WebP; the declared type is ignored, since some runtimes drop it and any client can fake it), stores it in the `media` R2 bucket under a fresh `avatars/<userId>/<uuid>` key and saves its address `<server>/media/<key>`; the previous photo is deleted, as is the photo removed with `image: null`. The bucket is private; the server serves `/media/*` from it with a year-long immutable cache, since every upload has its own address. Better Auth's sign-up and update-user refuse an `image`. Clients square and shrink photos to 512×512 before uploading. Tests and the local sample backend keep photos in memory.
- Switching a profile to public accepts existing pending requests atomically. Switching to private retains accepted followers. The client presents the confirmation and implications before calling `profiles.update`.
- Starred contains references to other people's links; Favorites contains references to the owner's own links. Each is a lazily created, unique system group. Starred is always owner-only, including legacy rows marked public. Favorites defaults to public and its visibility is editable; but their names and existence are protected. Original links cannot be moved into them. Their contents must pass **both** the collection's visibility and the original link's visibility. Revocation hides a reference without deleting it; restoring access can reveal it again.
- Repeating a star or follow operation preserves the existing relationship and timestamps. Unfollow, reject, remove-follower and unstar are idempotent. Rejecting a request does not remove an already accepted follower.
- Any signed-in viewer who can access a link may comment. Authors can edit their own comments while access remains and delete their own comments even after losing access. Link owners may delete comments on their links. Comments are plain text; clients must render them as text, not HTML. Responding adds another flat comment with an optional @username in its text; there are no threaded replies.
- Feed ordering uses the original link's save time; starring, commenting and editing do not create feed events. Following someone includes their existing visible saves.
- Recommendations count distinct accepted followees who themselves follow the candidate. Each suggested or searched person also carries the current viewer’s `followingStatus` (`pending`, `accepted`, or `null`; always `null` for guests), so list clients do not need per-person profile reads. Each carries `followedBy`: up to two people the viewer follows who follow them, and the total (empty for guests), the same shape a profile has. They exclude self and existing outgoing relationships, including pending requests. Only accessible intermediate follow graphs contribute. An empty social graph produces no recommendations.
- The server assigns each link's category when it is saved or its URL changes; clients cannot set it. URL/domain rules decide first because they are the most precise. Otherwise the page's JSON-LD schema.org type, its `og:type`, and finally its content type decide. Unknown pages are `uncategorized`.
- Reading a page (`links.create`, and `links.update` with a new URL) fetches only public http(s) URLs on default ports. Local, private and `.local`/`.internal` hosts are refused, every redirect hop is checked (at most 3), the whole read is limited to 4 seconds and the first 1.5 MB, and requests identify as `IndexBot`. Titles prefer `og:title`, then `twitter:title`, JSON-LD and `<title>`, drop the site's own name from either end, and fall back to a readable URL slug or the domain. Reading never fails a save. On Cloudflare, fetched pages are cached for an hour, so a link saved again soon is read only once.

## Pagination and persistence

Groups, links, comments, Starred/Favorites contents, activity and messages use newest-first `(createdAt, id)` keyset pagination. Requests accept `limit` (default 20, maximum 100) and opaque `cursor`; responses provide `items` and nullable `nextCursor`. Starred/Favorites contents use the original link's creation time. Conversation lists instead use `(updatedAt, id)`, so newly active conversations move up the inbox; clients should refresh the first page while polling. Cursors preserve PostgreSQL microseconds and remain usable if their original row is deleted. Authorization is reevaluated on every request; cursors never grant access.

User search and follow lists use ascending user ID pagination with `after`/`nextAfter` and the same limit bounds. Recommendations return a bounded snapshot, ordered by how many people you follow follow them, then user ID, with a maximum of 50.

Group deletion, profile publication, activity-producing writes, conversation creation and message/inbox updates use data-modifying PostgreSQL CTEs to keep dependent writes in a single atomic statement. This works with the existing Neon HTTP driver without pretending it supports interactive transactions. The additive migration described below is required. No dependencies were added.

Usernames are normalized to lowercase and must be 3–30 ASCII letters, digits or underscores. Sign-up requires one; Better Auth's username plugin validates it with the same rule and rejects a taken username with 400. The readable-routes migration assigns deterministic handles to older accounts that had none. Old usernames remain globally reserved after rename or account deletion. In `profiles.update`, a conflicting username returns 409. Other invalid input returns 400, missing authentication 401, inaccessible resources 404, and unexpected persistence failures a generic 500.

## Weekly views and Favorites

- `feed.weeks` — GET `/feed/weeks` lists the weeks with links from the viewer or accepted follows, newest first, with counts; paginated with `before`/`nextBefore` (`limit` up to 100). The home scrubber and week list use it.
- `feed.week` — GET `/feed/week` accepts an ISO Monday date in `weekStart` (not a week number). It returns `own` links, `people` with author identity and link pages, `olderWeek`, `newerWeek` and `nextAfter`. `olderWeek` and `newerWeek` are the nearest weeks with links from the viewer or accepted follows, so navigation skips empty weeks; `newerWeek` falls back to the current week and is null only for it. Only this week or a previous week is accepted.
- Own links include those in locked groups. Friends are accepted outgoing follows; only their accessible links contribute. The people carousel uses `limit` (default 10, max 30) and `after`; each person's links use `linkLimit` (default 20, max 100) and an independent `nextCursor`.
- `links.listByOwner` — GET `/profiles/{userId}/links` continues a person's links with the same `weekStart`, `cursor` and `limit`. It applies original-link visibility before pagination. Existing `links.listMine` and `links.listInGroup` also accept `weekStart`.
- `links.weeks` — GET `/profiles/{userId}/weeks` returns nonempty Monday buckets with visible link counts and `nextBefore`. Inputs are `limit` and optional `before` and `groupId`. This supports a profile's weekly archive, including Starred and Favorites.
- Weekly feed reads use three database round trips regardless of the number of authors in the page: authors, neighboring weeks, and a batch of links ranked per owner. Per-person limits, cursors, collection flags and visibility checks are preserved.
- Links have a `savedOn` calendar date for weekly grouping. The server sets it to today's UTC date on creation; clients cannot set or change it, so a link always belongs to the week it was shared. Week boundaries use UTC. The existing chronological `feed.list` remains available.
- Link responses include viewer-specific `isStarred` and `isFavorite` flags.
- `favorites.add` / `favorites.remove` — PUT / DELETE `/links/{linkId}/favorite`.
- `favorites.group` — GET `/me/favorites/group`; `favorites.list` — GET `/me/favorites`.
- Favoriting is idempotent and restricted to the original owner, including a database ownership constraint. It never moves or duplicates a link.
- All, Starred, Favorites and Settings are reserved route names for new or renamed custom groups. Group names/slugs are unique per owner; historical slugs remain reserved. See [readable routes](readable-routes.md) for canonical URLs, resolution, collision handling and migration repair.

## Activity

`activity.list` — GET `/me/activity` returns a cursor page and the global unread count. Its optional `type` filter is `comment`, `mention`, `follow`, `request` or `accepted`. There are no star or favorite notifications.

`activity.markRead` — POST `/me/activity/read` accepts `{ ids: [...] }` (1–100 activity IDs). It affects only the caller's events and preserves the original read timestamp on retries.

Follow requests carry `pending`, `accepted`, `declined` or `canceled` status. The existing follow-request actions resolve that status atomically with the relationship. Publishing a private profile also resolves pending requests and notifies accepted requesters. Repeating an unchanged follow/accept operation does not create duplicate events.

Standalone `@username` mentions are case-insensitive and notify existing readers who can access the original post. Self-mentions, duplicate handles, emails and URL paths do not generate extra events. Each comment has one event per recipient; a mentioned owner receives a mention instead of a second comment event. Edits synchronize recipients and preserve read state for retained notifications. Mention removal deletes that notification. The web and native Activity filters are All, Comments, Requests, Mentions and Follows; acceptance events remain in All.

Comment and mention activity references the live comment and original link instead of copying private text. Edits are reflected, deletion cascades, and reads recheck original-link visibility. Relationship/comment writes and their activity events succeed or roll back together.

## Direct and group messages

All messaging endpoints require authentication:

| Procedure                     | HTTP                                            | Behavior                                                                            |
| ----------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `messages.createConversation` | POST `/conversations`                           | Create or reuse an exact set of participants                                        |
| `messages.conversations`      | GET `/conversations`                            | Cursor inbox; optional literal `query` searches other participants' names/usernames |
| `messages.conversation`       | GET `/conversations/{conversationId}`           | Participants, last message, unread count and `canSend`                              |
| `messages.list`               | GET `/conversations/{conversationId}/messages`  | Newest-first message page                                                           |
| `messages.send`               | POST `/conversations/{conversationId}/messages` | Send text and/or an original-link attachment                                        |
| `messages.markRead`           | POST `/conversations/{conversationId}/read`     | Advance read state through `messageId`                                              |
| `messages.unread`             | GET `/me/messages/unread`                       | Unread message count across conversations                                           |

Creation accepts `recipientIds`: 1–19 distinct other users. The caller must follow every recipient with an accepted relationship; the recipients do not need to follow the caller back. Once a conversation exists, every member may reply, even without following the other members. Unfollowing retains readable history and the ability to reply. Nonmembers cannot inspect, send to or mark a conversation read.

A canonical set of participant IDs identifies a conversation. Selecting multiple people creates one group conversation, and selecting the same set reuses it. There are no group names or membership-edit operations: clients derive the heading from `participants`, excluding the current user.

Sending accepts `{ clientId, body?, linkId? }`. The client supplies a stable UUID per send attempt, including retries. Identical retries return the original message; reusing that ID with different contents or a different conversation is rejected. Empty text without a link is invalid. Sending and updating inbox order happen atomically.

Attachments reference originals. The sender must be able to access the original, and originals in locked groups cannot be forwarded. Recipients need not have original access. Sending grants no new permissions, and visibility is evaluated separately for each reader, including inbox previews. An authorized reader receives `attachment`. A reader blocked by a private profile receives a null attachment and `restrictedAuthor` containing only the author's public profile identity, so they can request to follow. No original title, URL, description, or comments are exposed. Deleted or later-locked originals have neither attachment nor restricted author. `hasAttachment` survives original deletion so clients can render “Post unavailable.”

Read state is a monotonic message watermark. Marking an older message read cannot roll it back or clear newer arrivals. Own messages do not count as unread. Clients can poll these endpoints and invalidate queries after writes; no realtime transport or push delivery is introduced. Recipient selection and unsent attachments/text remain client-local until sending.

## Database

`packages/db/src/migrations` contains the checked-in migration history shared by development, staging, and production. The initial migration has been deployed: never rewrite, rename, or consolidate applied migrations. Generate a new migration for each schema change and promote the same files through staging to production. Replacing migration names makes an existing database treat the replacement as unapplied and try to create tables that already exist.

## Verification

`bun test packages/api/src apps/server/src` runs real PostgreSQL queries in isolated PGlite databases with the project's migrations. Coverage includes profile/group visibility, original-link revocation, owner-only graphs, Favorites ownership, weekly boundaries, comment/follow activity, unnamed group conversations, send retries, unread watermarks, atomic rollback, pagination/search, HTTP/RPC contracts, browser-safe contract imports and the Better Auth session lifecycle. This does not replace a deployment smoke test against Neon and the Workers runtime.

Deployment smoke tests, native packaging, and device verification are separate from these backend tests. See `docs/desktop.md` and `apps/ios/README.md` for the native implementation and remaining verification.

## Notification delivery

Verified `/me/notifications/*` endpoints expose account preferences, device capabilities, enrollment/removal/status, active conversation leases, desktop poll/ack and Web Push resolution. Device operations include installation proof and the exact expected session ID. Durable outbox triggers, delivery privacy, APNs/Web Push configuration and launch checks are documented in [notifications](notifications.md).
