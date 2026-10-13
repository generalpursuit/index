# API contracts

The application exposes REST at `/api/v1` and typed oRPC at `/rpc/v1`, with `/rpc` retained as an alias. Import browser-safe contracts from `@index/api/contracts`. The generated endpoint reference is `/api/v1/docs`, backed by `/api/v1/openapi.json`; [transport.ts](../apps/server/src/transport.ts) generates it from feature contracts. Better Auth owns `/api/auth` and its separate `/api/auth/open-api/generate-schema`.

[app.ts](../apps/server/src/app.ts) mounts Hono, CORS, auth, media and transports; the [Worker entrypoint](../apps/server/src/index.ts) supplies runtime services and scheduled delivery. Only application API requests create API context. Feature operations own application rules; repositories own queries, including joins. [Route resolution](../packages/api/src/features/routes/resolve.ts) follows this boundary too.

Browser calls include the secure HttpOnly session cookie. Native clients retain the signed `set-auth-token` response header and send it as `Authorization: Bearer <token>`; the JSON token is unsigned and unsuitable. See [authentication](authentication.md) for verification and credential lifetime.

## Client versions

Clients send `X-Index-Client: <platform>/<version>` (`web`, `desktop` or `ios`) with the product version they were built from. [client-version.ts](../apps/server/src/client-version.ts) answers releases below their platform's minimum with `426` and `CLIENT_UPDATE_REQUIRED` before auth or API context runs; a staging build counts as its release, and unidentified clients are not gated. Clients then block until updated: web reloads, desktop restarts into its newest release and iOS asks for an App Store update.

Raise a minimum only after a release with compatible clients is published, or the gated clients have nothing to update to. iOS updates arrive on Apple's schedule, so keep its minimum lower for longer.

## Visibility and groups

[Visibility predicates](../packages/api/src/data-access/visibility.ts) must run **before pagination and counts**. Missing and inaccessible resources return the same not-found response; a cursor or readable ID never grants access.

- Links without a group follow profile visibility. Public groups also respect it: private profiles allow only their owner and accepted followers.
- A private group is always owner-only. Clients call `private` **Locked** and `public` **Unlocked**. Deleting a locked group while retaining its links removes that protection; explain the resulting visibility before confirmation.
- Basic profile identity remains discoverable for private profiles; email and auth fields do not. Follower/following lists and counts are owner-only. Other viewers receive null link counts for private profiles; public counts include only visible originals.
- Starred references other people's originals and is always owner-only. Favorites references the owner's originals and has editable visibility. Both are protected system groups: originals cannot be moved into them, and their names/existence cannot be edited. Reads enforce both collection and original visibility; revocation hides a reference without deleting it.
- Publishing a private profile atomically accepts pending follow requests. Making it private retains accepted followers. Privacy changes require confirmation. Custom group names and historical slugs remain subject to [route reservations](readable-routes.md).

Comments are plain text on accessible originals. Authors can edit while they retain access and delete their own comments even after losing it; link owners can moderate comments on their links. Activity references live sources and rechecks visibility rather than storing private text copies.

## Ordering and atomicity

Links are grouped by their server-assigned `savedOn` date, in UTC Monday weeks. Starring, commenting or editing does not create a new save or move a link to another week.

Most lists use opaque `(createdAt, id)` keyset cursors; inboxes use `(updatedAt, id)` and should refresh their first page when polling. Weekly indexes and people searches have their own cursors in the generated contracts. Preserve cursor precision and recheck authorization on every page.

Neon HTTP does not provide interactive transactions. Multi-write invariants use atomic SQL statements/functions: relationship/activity changes, group deletion, message/inbox updates and share receipts must succeed together. Checked-in migrations include custom triggers and functions; follow the [migration rules](deployment.md#database-and-recovery).

## Messages and retries

An exact participant set identifies a conversation. Its creator must have accepted outgoing follows to the other participants; existing members can keep reading and replying after unfollowing. Nonmembers cannot inspect, send or mark read. Read state is a monotonic message watermark; acknowledging an older message cannot clear newer arrivals. A conversation's read receipt is the viewer's newest message at or below every other member's watermark, so members learn read state only for their own messages.

A send owns an immutable `clientId`, conversation and payload until its outcome is known. The payload is the text, the attached link and the replied message. Retry an uncertain write with that same identity and payload, including after navigation. A retry that matches a committed message returns it before anything is validated again, so deleting the attached link or the replied message meanwhile does not reject it. Reusing the ID with different contents is rejected. A deliberate abandonment does not retract a possibly committed send. [Link sharing](sharing.md) uses the corresponding `requestId` receipt contract.

A reply can only quote a message in its own conversation. It carries an excerpt of that message and whether it had an attachment, never the attachment itself; once the replied message is deleted, the reply is no longer quoted.

Forwarding an original grants no access to it. Locked originals cannot be forwarded. A reader blocked by profile privacy receives only the author's public identity; locked/deleted originals expose neither content nor that fallback. A message keeps the attached link's ID as sent, so its attachment marker survives deletion and clients can show an unavailable post.

## External data and photos

[Metadata reads](../packages/api/src/features/links/metadata.ts) accept only public HTTP(S) destinations, check redirects, and bound time and bytes. Metadata failure must not fail a save.

[Photo uploads](../packages/api/src/features/profiles/service.ts) validate bytes and use fresh immutable storage keys. The database swaps the address and returns the actual old photo for cleanup. Cleanup failure cannot undo a committed update. An unknown database outcome must retain the new object: a later read cannot rule out a delayed commit. This can leave an orphan, but avoids deleting a live photo.

## Checks

From the root, `bun test packages/api/src apps/server/src` exercises contracts and migrations in disposable PGlite databases. Deployment smoke checks cover the Workers/Neon boundary separately; [notifications](notifications.md) owns delivery checks.
