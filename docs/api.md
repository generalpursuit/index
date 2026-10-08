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
| `profiles.get`              | GET `/profiles/{userId}`                   | Basic public identity and viewer's access/follow state                                     |
| `profiles.byUsername`       | GET `/profiles/by-username/{username}`     | Look up a normalized username                                                              |
| `groups.create`             | POST `/groups`                             | Create an owned custom group; defaults to public                                           |
| `groups.list`               | GET `/groups`                              | Visible groups for `ownerId`; defaults to the signed-in user                               |
| `groups.get`                | GET `/groups/{id}`                         | Get a visible group                                                                        |
| `groups.update`             | PATCH `/groups/{id}`                       | Change an owned group's name or visibility                                                 |
| `groups.delete`             | DELETE `/groups/{id}`                      | Preserve links in inbox by default; JSON body `{ deleteLinks: true }` deletes them instead |
| `links.create`              | POST `/links`                              | Save to inbox, or an owned custom `groupId`                                                |
| `links.listMine`            | GET `/links`                               | Owned links; optional `groupId`, `inbox`, `category` filters; authenticated                |
| `links.get`                 | GET `/links/{id}`                          | Get a visible original link                                                                |
| `links.update`              | PATCH `/links/{id}`                        | Edit an owned link or move it; `groupId: null` returns it to inbox                         |
| `links.delete`              | DELETE `/links/{id}`                       | Delete an owned link and cascade its stars/comments                                        |
| `links.listInGroup`         | GET `/groups/{groupId}/links`              | Visible originals in a custom or Starred group                                             |
| `follows.follow`            | POST `/profiles/{userId}/follow`           | Follow a public profile or request a private profile                                       |
| `follows.unfollow`          | DELETE `/profiles/{userId}/follow`         | Unfollow or cancel a pending request                                                       |
| `follows.followers`         | GET `/profiles/{userId}/followers`         | Accepted incoming relationships if the profile's graph is visible                          |
| `follows.following`         | GET `/profiles/{userId}/following`         | Accepted outgoing relationships if the profile's graph is visible                          |
| `follows.requests`          | GET `/me/follow-requests`                  | Pending incoming requests; authenticated                                                   |
| `follows.accept`            | POST `/me/follow-requests/{userId}/accept` | Accept an incoming request                                                                 |
| `follows.reject`            | DELETE `/me/follow-requests/{userId}`      | Remove a pending incoming request                                                          |
| `follows.removeFollower`    | DELETE `/me/followers/{userId}`            | Remove an incoming relationship                                                            |
| `stars.add`                 | PUT `/links/{linkId}/star`                 | Add a visible original to the current user's Starred group                                 |
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
- A private group is always owner-only, including under a private profile with accepted followers.
- A public group under a public profile is available anonymously. A public group under a private profile is available to its owner and accepted followers.
- Basic profile identity (ID, name, username, bio, image and visibility) remains discoverable for private profiles. Email and authentication fields are excluded. Private profiles' follow lists require access to that profile's content.
- Switching a profile to public accepts existing pending requests atomically. Switching to private retains accepted followers.
- Starred is a lazily created, unique system group, public by default. Its visibility is editable, but its name and existence are protected. Original links cannot be moved into it. Its contents must pass **both** the starring group's visibility and the original link's visibility. Revocation hides a reference without deleting it; restoring access can reveal it again.
- Repeating a star or follow operation preserves the existing relationship and timestamps. Unfollow, reject, remove-follower and unstar are idempotent. Rejecting a request does not remove an already accepted follower.
- Any signed-in viewer who can access a link may comment. Authors can edit their own comments while access remains and delete their own comments even after losing access. Link owners may delete comments on their links. Comments are plain text; clients must render them as text, not HTML. Replies are outside this API.
- Feed ordering uses the original link's save time; starring, commenting and editing do not create feed events. Following someone includes their existing visible saves.
- Recommendations count distinct accepted followees who themselves follow the candidate. They exclude self and existing outgoing relationships, including pending requests. Only accessible intermediate follow graphs contribute. An empty social graph produces no recommendations.
- Category suggestions inspect URL/domain rules without fetching pages. Unknown URLs return `{ category: "uncategorized", matched: false }`. Clients call the suggestion endpoint after paste, then send the selected category when saving. Manual selection always wins; saving without a category keeps the existing `uncategorized` default.

## Pagination and persistence

Groups, links, comments, Starred contents and feed use newest-first `(createdAt, id)` keyset pagination. Requests accept `limit` (default 20, maximum 100) and opaque `cursor`; responses provide `items` and nullable `nextCursor`. Starred contents currently use the original link's save time. Cursors preserve PostgreSQL microseconds and remain usable if their original row is deleted. Authorization is reevaluated on every request; cursors never grant access.

User search and follow lists use ascending user ID pagination with `after`/`nextAfter` and the same limit bounds. Recommendations return a bounded snapshot, ordered by mutual count then user ID, with a maximum of 50.

Group deletion and publication of a private profile use data-modifying PostgreSQL CTEs to keep dependent writes in a single atomic statement. This works with the existing Neon HTTP driver without pretending it supports interactive transactions. No new database migrations or dependencies are required.

Usernames are normalized to lowercase and must be 3–30 ASCII letters, digits or underscores. A conflicting username returns 409. Other invalid input returns 400, missing authentication 401, inaccessible resources 404, and unexpected persistence failures a generic 500.

## Verification

`bun test packages/api/src apps/server/src` runs real PostgreSQL queries in isolated PGlite databases with the project's migrations. Coverage includes the profile/group visibility combinations, revocation, comments, directed follow state, retries, cascades and atomic rollback, pagination, recommendations, HTTP/RPC contracts, browser-safe contract imports, and Better Auth session lifecycle. This does not replace a deployment smoke test against Neon and the Workers runtime.

The API implementation does not include frontend screens, Swift client generation, native secure-storage code, desktop packaging, or a deployment.
