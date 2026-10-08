# Index API

The API uses feature-local contracts, Zod schemas, routers with inline handlers, services, and repositories. Services return `neverthrow` results. Repositories own database queries, including joins across tables. Authorization predicates live in `packages/api/src/data-access/visibility.ts` and are applied before pagination.

## Transports and authentication

- Typed oRPC: `/rpc/v1` (`/rpc` remains an alias). Import `AppRouterClient` from `@index/api/contracts`.
- REST: `/api/v1`; OpenAPI: `/api/v1/openapi.json`; reference: `/api/v1/docs`.
- Better Auth: `/api/auth`; its OpenAPI document: `/api/auth/open-api/generate-schema`.
- Browser clients use Better Auth's secure HttpOnly session cookie and `credentials: "include"`.
- Native clients sign up at `POST /api/auth/sign-up/email` with `{ name, email, password }`, or sign in at `POST /api/auth/sign-in/email` with `{ email, password }`.
- Native clients must retain the **signed `set-auth-token` response header**, then send `Authorization: Bearer <token>` to both APIs. The unsigned token in the JSON response is not accepted as a bearer credential.
- Restore a native session with `GET /api/auth/get-session`; log out with `POST /api/auth/sign-out`. Replace a stored token if a later response supplies `set-auth-token`. Store it in the platform's secure credential store (Keychain on iOS), share it with an extension only through a deliberately configured shared Keychain group, and erase it on logout or session expiry. The client-side storage and share-extension integration are not implemented by this backend change.

Better Auth continues to own login, credentials and sessions. Its routes are not reimplemented in oRPC. The two OpenAPI documents describe the application and authentication surfaces respectively. See [Better Auth bearer integration](https://better-auth.com/docs/plugins/bearer) and [authentication OpenAPI](https://better-auth.com/docs/plugins/open-api).

## Application endpoints

Paths below are relative to `/api/v1`. All mutations require authentication. Public reads accept optional credentials and return only content visible to that viewer. Missing and inaccessible resources both return 404.

| Procedure                   | HTTP                                       | Behavior                                                                                   |
| --------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `profiles.me`               | GET `/me/profile`                          | Current user's profile; authenticated                                                      |
| `profiles.update`           | PATCH `/me/profile`                        | Edit name, username, bio, image URL and profile visibility                                 |
| `profiles.get`              | GET `/profiles/{userId}`                   | Public identity, viewer access, private counts and social context                          |
| `profiles.byUsername`       | GET `/profiles/by-username/{username}`     | Look up a normalized username                                                              |
| `groups.create`             | POST `/groups`                             | Create an owned custom group; defaults to public                                           |
| `groups.list`               | GET `/groups`                              | Visible groups; `includeFavorites: true` opts into the Favorites kind                      |
| `groups.get`                | GET `/groups/{id}`                         | Get a visible group                                                                        |
| `groups.update`             | PATCH `/groups/{id}`                       | Change an owned group's name or visibility                                                 |
| `groups.delete`             | DELETE `/groups/{id}`                      | Preserve links in inbox by default; JSON body `{ deleteLinks: true }` deletes them instead |
| `links.create`              | POST `/links`                              | Save to inbox, or an owned custom `groupId`                                                |
| `links.listMine`            | GET `/links`                               | Owned links; optional `groupId`, `inbox`, `category` filters; authenticated                |
| `links.get`                 | GET `/links/{id}`                          | Get a visible original link                                                                |
| `links.update`              | PATCH `/links/{id}`                        | Edit an owned link or move it; `groupId: null` returns it to inbox                         |
| `links.delete`              | DELETE `/links/{id}`                       | Delete an owned link and cascade its stars, favorites and comments                         |
| `links.listInGroup`         | GET `/groups/{groupId}/links`              | Visible originals in a custom, Starred or Favorites group                                  |
| `follows.follow`            | POST `/profiles/{userId}/follow`           | Follow a public profile or request a private profile                                       |
| `follows.unfollow`          | DELETE `/profiles/{userId}/follow`         | Unfollow or cancel a pending request                                                       |
| `follows.followers`         | GET `/profiles/{userId}/followers`         | Own accepted followers; other users receive 404                                            |
| `follows.following`         | GET `/profiles/{userId}/following`         | Own accepted followees; optional literal `query` for recipient search                      |
| `follows.requests`          | GET `/me/follow-requests`                  | Pending incoming requests; authenticated                                                   |
| `follows.accept`            | POST `/me/follow-requests/{userId}/accept` | Accept an incoming request                                                                 |
| `follows.reject`            | DELETE `/me/follow-requests/{userId}`      | Remove a pending incoming request                                                          |
| `follows.removeFollower`    | DELETE `/me/followers/{userId}`            | Remove an incoming relationship                                                            |
| `stars.add`                 | PUT `/links/{linkId}/star`                 | Star another person's visible original link                                                |
| `stars.remove`              | DELETE `/links/{linkId}/star`              | Remove own star, even if the original is now inaccessible                                  |
| `stars.group`               | GET `/me/starred/group`                    | Get/create own Starred group; authenticated                                                |
| `stars.list`                | GET `/me/starred`                          | Accessible originals in own Starred group; authenticated                                   |
| `comments.create`           | POST `/links/{linkId}/comments`            | Add a flat text comment to an accessible link                                              |
| `comments.list`             | GET `/links/{linkId}/comments`             | Visible comments with public author identity                                               |
| `comments.update`           | PATCH `/comments/{id}`                     | Edit own comment while the link is accessible                                              |
| `comments.delete`           | DELETE `/comments/{id}`                    | Delete own comment, or moderate a comment on an owned link                                 |
| `feed.list`                 | GET `/feed`                                | Newest accessible original saves from accepted followees; authenticated                    |
| `discovery.searchUsers`     | GET `/discovery/users`                     | Search public names/usernames using `query`                                                |
| `discovery.recommendations` | GET `/discovery/recommendations`           | Second-degree suggestions; authenticated                                                   |
| `categories.suggest`        | POST `/categories/suggest`                 | Suggest a category for `{ url }`; authenticated                                            |

Existing `/health` and authenticated `/private-data` remain available for compatibility.

## Visibility and interaction rules

- Inbox is represented by `links.groupId = null` and is always owner-only.
- A private group is always owner-only, including under a private profile with accepted followers. The UI calls this **Locked**; **Unlocked** maps to public. The stored/API values remain `private` and `public`.
- A public group under a public profile is available anonymously. A public group under a private profile is available to its owner and accepted followers.
- Basic profile identity (ID, name, username, bio, image and visibility) remains discoverable for private profiles. Email and authentication fields are excluded. Follower and following lists are owner-only for every profile. Their counts are null for other viewers. Other private profiles also return a null link count; public profiles count only accessible originals.
- Profiles include `followedBy: { users, total }`: at most two of the viewer's accepted followees who also follow that profile, plus their total. This supports “Followed by…” without exposing the profile's follower count.
- Switching a profile to public accepts existing pending requests atomically. Switching to private retains accepted followers. The client presents the confirmation and implications before calling `profiles.update`.
- Starred contains references to other people's links; Favorites contains references to the owner's own links. Each is a lazily created, unique system group, public by default. Their visibility is editable, but their names and existence are protected. Original links cannot be moved into them. Their contents must pass **both** the collection's visibility and the original link's visibility. Revocation hides a reference without deleting it; restoring access can reveal it again.
- Repeating a star or follow operation preserves the existing relationship and timestamps. Unfollow, reject, remove-follower and unstar are idempotent. Rejecting a request does not remove an already accepted follower.
- Any signed-in viewer who can access a link may comment. Authors can edit their own comments while access remains and delete their own comments even after losing access. Link owners may delete comments on their links. Comments are plain text; clients must render them as text, not HTML. Responding adds another flat comment with an optional @username in its text; there are no threaded replies.
- Feed ordering uses the original link's save time; starring, commenting and editing do not create feed events. Following someone includes their existing visible saves.
- Recommendations count distinct accepted followees who themselves follow the candidate. They exclude self and existing outgoing relationships, including pending requests. Only accessible intermediate follow graphs contribute. An empty social graph produces no recommendations.
- Category suggestions inspect URL/domain rules without fetching pages. Unknown URLs return `{ category: "uncategorized", matched: false }`. Clients call the suggestion endpoint after paste, then send the selected category when saving. Manual selection always wins; saving without a category keeps the existing `uncategorized` default.

## Pagination and persistence

Groups, links, comments, Starred/Favorites contents, activity and messages use newest-first `(createdAt, id)` keyset pagination. Requests accept `limit` (default 20, maximum 100) and opaque `cursor`; responses provide `items` and nullable `nextCursor`. Starred/Favorites contents use the original link's creation time. Conversation lists instead use `(updatedAt, id)`, so newly active conversations move up the inbox; clients should refresh the first page while polling. Cursors preserve PostgreSQL microseconds and remain usable if their original row is deleted. Authorization is reevaluated on every request; cursors never grant access.

User search and follow lists use ascending user ID pagination with `after`/`nextAfter` and the same limit bounds. Recommendations return a bounded snapshot, ordered by mutual count then user ID, with a maximum of 50.

Group deletion, profile publication, activity-producing writes, conversation creation and message/inbox updates use data-modifying PostgreSQL CTEs to keep dependent writes in a single atomic statement. This works with the existing Neon HTTP driver without pretending it supports interactive transactions. The additive migration described below is required. No dependencies were added.

Usernames are normalized to lowercase and must be 3–30 ASCII letters, digits or underscores. A conflicting username returns 409. Other invalid input returns 400, missing authentication 401, inaccessible resources 404, and unexpected persistence failures a generic 500.

## Weekly views and Favorites

- `feed.week` — GET `/feed/week` accepts an ISO Monday date in `weekStart` (not a week number). It returns `own` links, `people` with author identity and link pages, `olderWeek`, `newerWeek` and `nextAfter`. Only this week or a previous week is accepted.
- Own links include Inbox and locked groups. Friends are accepted outgoing follows; only their accessible links contribute. The people carousel uses `limit` (default 10, max 30) and `after`; each person's links use `linkLimit` (default 20, max 100) and an independent `nextCursor`.
- `links.listByOwner` — GET `/profiles/{userId}/links` continues a person's links with the same `weekStart`, `cursor` and `limit`. It applies original-link visibility before pagination. Existing `links.listMine` and `links.listInGroup` also accept `weekStart`.
- `links.weeks` — GET `/profiles/{userId}/weeks` returns nonempty Monday buckets with visible link counts and `nextBefore`. Inputs are `limit`, optional `before` and either `groupId` or `inbox`. This supports a profile's weekly archive, including Starred and Favorites.
- Links have a separate `savedOn` calendar date for weekly grouping. Create/update accepts past or current dates; omission on creation defaults to today's UTC date. Backdating a link never changes its immutable `createdAt`. Week boundaries use UTC. The existing chronological `feed.list` remains available.
- Link responses include viewer-specific `isStarred` and `isFavorite` flags.
- `favorites.add` / `favorites.remove` — PUT / DELETE `/links/{linkId}/favorite`.
- `favorites.group` — GET `/me/favorites/group`; `favorites.list` — GET `/me/favorites`.
- Favoriting is idempotent and restricted to the original owner, including a database ownership constraint. It never moves or duplicates a link.
- New clients use `groups.list({ includeFavorites: true })`. Omitting the flag excludes Favorites, so older clients with a strict group-kind enum can keep using the endpoint. All, Inbox, Starred and Favorites are reserved names for new or renamed custom groups.

## Activity

`activity.list` — GET `/me/activity` returns a cursor page and the global unread count. Its optional `type` filter is `comment`, `follow`, `request` or `accepted`. There are no star or favorite notifications.

`activity.markRead` — POST `/me/activity/read` accepts `{ ids: [...] }` (1–100 activity IDs). It affects only the caller's events and preserves the original read timestamp on retries.

Follow requests carry `pending`, `accepted`, `declined` or `canceled` status. The existing follow-request actions resolve that status atomically with the relationship. Publishing a private profile also resolves pending requests and notifies accepted requesters. Repeating an unchanged follow/accept operation does not create duplicate events.

Comment activity references the live comment and original link instead of copying private text. Edits are reflected, deletion cascades, and reads recheck original-link visibility. Relationship/comment writes and their activity events succeed or roll back together.

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

Creation accepts `recipientIds`: 1–19 distinct other users. The caller must follow every recipient with an accepted relationship; the recipients do not need to follow the caller back. The same rule applies when sending, including replies. Unfollowing retains readable history but makes `canSend` false until the sender follows all other participants again. Nonmembers cannot inspect, send to or mark a conversation read.

A canonical set of participant IDs identifies a conversation. Selecting multiple people creates one group conversation, and selecting the same set reuses it. There are no group names or membership-edit operations: clients derive the heading from `participants`, excluding the current user.

Sending accepts `{ clientId, body?, linkId? }`. The client supplies a stable UUID per send attempt, including retries. Identical retries return the original message; reusing that ID with different contents or a different conversation is rejected. Empty text without a link is invalid. Sending and updating inbox order happen atomically.

Attachments reference originals. Every participant must be able to access the link at send time; Inbox and locked originals cannot be forwarded. Sending grants no new permissions. Each reader's attachment becomes null if access is revoked or the original is deleted, including in inbox previews. Clients should handle a textless message with a null attachment as an unavailable link.

Read state is a monotonic message watermark. Marking an older message read cannot roll it back or clear newer arrivals. Own messages do not count as unread. Clients can poll these endpoints and invalidate queries after writes; no realtime transport or push delivery is introduced. Recipient selection and unsent attachments/text remain client-local until sending.

## Migration and client rollout

Apply `packages/db/src/migrations/20261008175003_prototype_api/migration.sql` with the project's Drizzle migration command before deploying this backend. Deployment should serialize migration execution. It adds messaging, activity and Favorites tables, indexes and constraints, plus the link save date.

Existing links retain their UTC creation date as `savedOn`. Existing self-stars move to Favorites with their original timestamps and the old Starred group's visibility; other stars remain untouched. Existing pending follow requests are imported into Activity. Older completed activity is not fabricated.

Existing routes remain available. New response fields are additive, and Favorites is opt-in in group listings. The intentional policy changes also apply to older clients: follower graphs are owner-only, own links use Favorites instead of stars, and system group names are reserved.

The migration has been tested locally but has not been applied to a live database. The prototype still uses its mock data; wiring frontend screens and generating Swift clients are separate integration work.

## Verification

`bun test packages/api/src apps/server/src` runs real PostgreSQL queries in isolated PGlite databases with the project's migrations. Coverage includes profile/group visibility, original-link revocation, owner-only graphs, Favorites ownership, weekly boundaries, upgrading an existing database, comment/follow activity, unnamed group conversations, send retries, unread watermarks, atomic rollback, pagination/search, HTTP/RPC contracts, browser-safe contract imports and the Better Auth session lifecycle. This does not replace a deployment smoke test against Neon and the Workers runtime.

The API implementation does not include frontend screens, Swift client generation, native secure-storage code, desktop packaging, or a deployment.
