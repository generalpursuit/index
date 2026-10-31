# Data loading

Every client should feel instant and calm. A screen does not show a spinner for data the device already has, nothing moves when data arrives, and nothing flickers. The server stays the source of truth: web, desktop and iOS each keep an account-scoped cache in memory and on disk, and follow the same rules for showing, refreshing and editing what it holds.

## Showing data

Render from the cache first. Data held in memory or on disk renders immediately, and refreshing it is silent: a refresh never replaces content with a loading state, and a failed refresh keeps usable content with retry feedback. Forbidden and not-found responses still hide content, as [account isolation](authentication.md#account-isolation) requires.

A screen shows a placeholder only when it has nothing to show yet. A placeholder is the real component in placeholder mode, so it has the final layout by construction. It stays hidden for the first 300 ms, so quick loads go straight to content, and once shown it stays at least 400 ms, so it never flashes. Full-screen spinners are not used for data; a spinner belongs only inside a control the user just pressed.

Geometry stays stable from placeholder to content. Lists keep their row heights, a container keeps its size while its contents load, and a modal does not resize or re-center when its data arrives. Loading more pages extends a list below what is already shown.

Navigation reuses what is already on screen. A link to a person, post, group or conversation carries the summary its row already holds, and the destination renders that summary at once while it loads the rest. Summaries come only from responses this account already received; a forbidden or missing response for the destination still hides them.

## Editing data

Edits apply instantly. The client updates the affected cached items before sending the request, shows a pending state only where the outcome matters to the user, and rolls back with an error message if the request fails. Results that only the server knows, such as a fetched link title or a follow that becomes a request, fill in when the response arrives. Responses patch the items they return; a client refetches only lists whose membership or order it cannot derive. Uncertain writes keep their immutable IDs and payloads for retries, as the [retry rules](api.md#messages-and-retries) require.

## Freshness

Each kind of data refreshes on its own schedule:

- **Live:** conversations, messages and activity follow the pulse below.
- **On show:** feeds, profiles, groups, posts and discovery refresh when a screen shows them and they are older than 30 seconds.
- **Stable:** settings and notification preferences refresh when shown and older than five minutes.

The pulse reports unread counts and a version for the viewer's conversations and activity. An authenticated account socket carries content-free invalidation hints. Clients reconcile through the pulse while visible on a hint, focus, foreground, reconnect or notification, and refetch only lists whose version changed. There is no periodic database poll. Hidden windows keep no content refresh loop; backgrounded iOS apps close their socket. Reconnects use backoff and reconcile missed events. Connection presence and keepalives remain at the edge.

Clients load what the user is likely to open next: on hover, focus or the start of a press; the main screens once the first screen is idle; and the first page behind a visible control. Prefetching stops when the device asks to save data.

A cold screen needs at most one round trip per dependency level. Requests that do not depend on each other start together, and the web client batches calls made in the same tick into one HTTP request, so they share one session lookup.

## Disk cache and account isolation

The disk cache belongs to one API server and one verified account, and carries a format version; a cache from another server, account or version is discarded unread. It is written only for the accepted account and erased on sign-out, session expiry, account change or a restricted session, before another account's data can be shown. A forbidden or not-found response removes the affected entries. On desktop the cache is also bound to the [native session revision](../apps/web/README.md#desktop-session-boundary), so a window never shows data for a revision it has not accepted. On iOS it lives in Application Support with file protection and is excluded from backups.

The cache holds content responses, including message contents, for at most seven days. Credentials stay in the platform's secure storage, message file bytes stay in memory apart from iOS's temporary Quick Look copies, and drafts, search results, security status and device notification state are not persisted.

## Ownership and checks

The server owns request cost, batching and the pulse; [API](api.md) documents their contracts. The [web and desktop](../apps/web/README.md) and [iOS](../apps/ios/README.md) guides own each client's cache, prefetching and placeholders.

Browser checks inject network latency and assert that revisiting a screen shows no placeholder or spinner, that content does not shift once shown, and how many requests a screen makes. iOS store and cache behavior has unit tests; screen behavior needs the simulator or a device.
