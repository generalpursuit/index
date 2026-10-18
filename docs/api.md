# API contracts

The application exposes REST at `/api/v1` and typed oRPC at `/rpc/v1`, with `/rpc` retained as an alias. Import browser-safe contracts from `@index/api/contracts`. The generated endpoint reference is `/api/v1/docs`, backed by `/api/v1/openapi.json`; [transport.ts](../apps/server/src/transport.ts) generates it from feature contracts. Better Auth owns `/api/auth` and its separate `/api/auth/open-api/generate-schema`.

[app.ts](../apps/server/src/app.ts) mounts Hono, CORS, auth, media and transports; the [Worker entrypoint](../apps/server/src/index.ts) supplies runtime services and scheduled delivery. Only application API requests create API context. Feature operations own application rules; repositories own queries, including joins. [Route resolution](../packages/api/src/features/routes/resolve.ts) follows this boundary too.

Browser calls include the secure HttpOnly session cookie. Native clients retain the signed `set-auth-token` response header and send it as `Authorization: Bearer <token>`; the JSON token is unsigned and unsuitable. See [authentication](authentication.md) for verification and credential lifetime.

RPC clients can add `BatchLinkPlugin` from `@orpc/client/plugins` to their `RPCLink`, with `groups: [{ condition: () => true, context: {} }]`. Its default `streaming` mode returns each result as it finishes; `buffered` is also supported. The plugin sends `X-ORPC-Batch: streaming` (or `buffered`), allowed by CORS. A batch of up to ten calls shares one API context and session lookup; each call retains its own result or error. Group only calls for the same server and account, and keep authorization and `X-Index-Client` on the outer request. The client-version gate applies before context creation. REST calls remain individual requests.

## Client versions

Clients send `X-Index-Client: <platform>/<version>` (`web`, `desktop` or `ios`) with the product version they were built from. [client-version.ts](../apps/server/src/client-version.ts) answers releases below their platform's minimum with `426` and `CLIENT_UPDATE_REQUIRED` before auth or API context runs; a staging build counts as its release, and unidentified clients are not gated. Clients then block until updated: web reloads, desktop restarts into its newest release and iOS links to the latest TestFlight build.

Raise a minimum only after a release with compatible clients is published, or the gated clients have nothing to update to. iOS updates arrive on Apple's schedule, so keep its minimum lower for longer.

## Visibility and groups

[Visibility predicates](../packages/api/src/data-access/visibility.ts) must run **before pagination and counts**. Missing and inaccessible resources return the same not-found response; a cursor or readable ID never grants access.

- Links without a group follow profile visibility. Public groups also respect it: private profiles allow only their owner and accepted followers.
- A private group is always owner-only. Clients call `private` **Locked** and `public` **Unlocked**. Deleting a locked group while retaining its links removes that protection; explain the resulting visibility before confirmation.
- Basic profile identity remains discoverable for private profiles; email and auth fields do not. Follower/following lists and counts are owner-only. Other viewers receive null link counts for private profiles; public counts include only visible originals.
- Starred references other people's originals and is always owner-only. Favorites references the owner's originals and is never locked; each original still follows its own group's lock. Both are protected system groups: originals cannot be moved into them, and their names/existence cannot be edited. Reads enforce both collection and original visibility; revocation hides a reference without deleting it.
- Publishing a private profile atomically accepts pending follow requests. Making it private retains accepted followers. Privacy changes require confirmation. Custom group names and historical slugs remain subject to [route reservations](readable-routes.md).

Comments are plain text on accessible originals. Authors can edit while they retain access and delete their own comments even after losing it; link owners can moderate comments on their links. Activity references live sources and rechecks visibility rather than storing private text copies.

## Ordering and atomicity

Links are grouped by their server-assigned `savedOn` date, in UTC Monday weeks. Starring, commenting or editing does not create a new save or move a link to another week.

Most lists use opaque `(createdAt, id)` keyset cursors; inboxes use `(updatedAt, id)` and should refresh their first page when polling. Weekly indexes and people searches have their own cursors in the generated contracts. Preserve cursor precision and recheck authorization on every page.

Neon HTTP does not provide interactive transactions. Multi-write invariants use atomic SQL statements/functions: relationship/activity changes, group deletion, message/inbox updates and share receipts must succeed together. Checked-in migrations include custom triggers and functions; follow the [migration rules](deployment.md#database-and-recovery).

## Messages and retries

The verified viewer's pulse returns `messages` and `activity`, each with an `unreadCount` and opaque `version`. Counts match the existing unread and activity reads. Versions fingerprint the visible state of each list's first page (up to the largest page size), so a pulse costs the same however long an inbox grows, and remain stable until that state changes, including membership, last messages, receipts, activity removal, request status and read state. Changes further down reach clients when they load those pages. Clients remember each version and refresh only changed lists, plus the open conversation's newest messages when the messages version changes; they must not interpret or order versions. Older servers may return 404, so clients fall back to their existing refresh behavior.

An exact participant set identifies a conversation. Its creator must have accepted outgoing follows to the other participants; existing members can keep reading and replying after unfollowing. Nonmembers cannot inspect, send or mark read. Read state is a monotonic message watermark; acknowledging an older message cannot clear newer arrivals. A conversation's read receipt is the viewer's newest message at or below every other member's watermark, so members learn read state only for their own messages.

A send owns an immutable `clientId`, conversation and payload until its outcome is known. The payload is the text, the attached link, the replied message and the files in their order. Retry an uncertain write with that same identity and payload, including after navigation. A retry that matches a committed message returns it before anything is validated again, so deleting the attached link or the replied message meanwhile does not reject it. Reusing the ID with different contents is rejected. A deliberate abandonment does not retract a possibly committed send. [Link sharing](sharing.md) uses the corresponding `requestId` receipt contract.

A reply can only quote a message in its own conversation. It carries an excerpt of that message, its files and whether it had a shared post, never the post itself; once the replied message is deleted, the reply is no longer quoted.

Forwarding an original grants no access to it. Locked originals cannot be forwarded. A reader blocked by profile privacy receives only the author's public identity; locked/deleted originals expose neither content nor that fallback. A message keeps the attached link's ID as sent, so its attachment marker survives deletion and clients can show an unavailable post.

A member uploads a file of at most 25 MB to a conversation before sending; the request body is capped at 26 MB to allow for multipart framing. Only the uploader can send an unsent file, and nobody can read it from the server. A send lists up to ten of the sender's unsent files from that conversation. The message stores their order, which is part of the retry identity, and a sent file cannot join another message.

Files are typed by their bytes: JPEG, PNG, GIF and WebP keep their image type, and anything else is served as `application/octet-stream`. Every API response carries `X-Content-Type-Options: nosniff`, so no file renders on the API origin. Members read sent files through the API; objects live in a private bucket with no public address.

Unsent files are swept after a day. Rows are deleted before objects, so a failed sweep leaves an orphaned object, never a file without its bytes. Deleting a user, conversation or message cascades to its file rows but not to their objects; whatever deletes those must delete the objects first.

## External data and photos

[Metadata reads](../packages/api/src/features/links/metadata.ts) accept only public HTTP(S) destinations, check redirects, and bound time and bytes. Metadata failure must not fail a save.

[curatee imports](../packages/api/src/features/imports/curatee.ts) read a public curatee.co profile through the site's own public Supabase API, uncached and bounded in time. Links keep their title, note and category and are saved into Your links on their original UTC day. One statement claims and saves them, so an import commits or fails as a whole. Its receipts survive link deletion: importing again adds only new links and never restores a deleted one.

[Photo uploads](../packages/api/src/features/profiles/service.ts) validate bytes and use fresh immutable storage keys. The database swaps the address and returns the actual old photo for cleanup. Cleanup failure cannot undo a committed update. An unknown database outcome must retain the new object: a later read cannot rule out a delayed commit. This can leave an orphan, but avoids deleting a live photo.

## Checks

From the root, `bun test packages/api/src apps/server/src` exercises contracts and migrations in disposable PGlite databases. Deployment smoke checks cover the Workers/Neon boundary separately; [notifications](notifications.md) owns delivery checks.
