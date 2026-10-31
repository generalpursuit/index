# Notifications

Account preferences select message/comment/mention/follow events; each device opts in separately. Categories default on, previews default off. A profile gets a follow `request` while private and a `follow` while public, never both for one follow, so clients show both as one Followers setting that writes both keys and is on only when both are. Permission is requested only on explicit enablement. Notification settings do not remove in-app activity, and notifications do not send email.

## Delivery and privacy

Database triggers atomically enqueue references with activity/message writes. Postgres owns the durable queue; Worker memory does not. A per-stage `OutboxClock` Durable Object schedules bounded delivery batches at their next retry deadline. No pending work means no scheduled delivery wake. macOS has a process-owned account socket and retrieves leased notifications on a change hint, including while the window is hidden. The retrieval response identifies remaining batches and the next outstanding lease deadline; the process schedules another read only for known work, so reconnecting cannot strand an interrupted delivery. Delivery is **at least once**: provider acceptance and local acknowledgement cannot commit together. Collapse IDs and client deduplication reduce duplicates.

Application middleware classifies mutations by their contract method, including RPC reads transported as POST. Before a verified mutation, it durably registers a two-minute recovery wake; completion accelerates dispatch. Auth writes that change sessions use the same boundary. Registration failure rejects the write before it runs. Concurrent completions advance a durable revision, so a draining worker cannot erase a newer wake. Each drain persists its own recovery alarm before external I/O. A request delayed beyond its recovery window can still commit later; daily maintenance recovers stranded work, so that exceptional path can delay an alert up to a day or let it expire. This is not a distributed atomic commit.

Independent `live_changes` triggers coalesce account invalidations with domain writes, regardless of notification permission or enrollment. Account hubs deliver content-free change hints over one-use authenticated ticket connections. Clients reconcile through the pulse on hints, reconnect and foreground. Tickets keep the requesting API origin, including native `workers.dev` aliases. They never contain bearer credentials and are consumed once; session revocation closes connections and removes unconsumed tickets. Connection attachments enforce session expiry before delivering hints. Keepalives stay at the edge; they do not authenticate through Postgres.

Each delivery and Web Push resolution rechecks the owning session, verified account, current preferences, source existence, membership/visibility, read state and active conversation. The outbox stores references and fixed status codes, not private text. Forwarded-link content and file names are never included in alerts; with previews on, a message without text says only what it carries, such as "Sent a photo." An OS-accepted alert cannot reliably be recalled after a later privacy change.

Web Push carries only an encrypted job ID. The service worker resolves current content with the session cookie, installation proof and expected session ID; it has no offline content cache. APNs sends only currently permitted content; previews off means generic text throughout the payload. Zero APNs expiration avoids queueing private alerts for offline devices.

Installation proof is distinct from login: every device operation also needs the exact verified session. Account changes reject late enrollment callbacks. Sign-out clears local state without waiting for notification removal. Active-conversation suppression is a short connection lease bound to the validated session, renewed at the edge only while focused/foregrounded. Presence never grants access; a hub outage favors delivering an alert. Clicks are recipient-bound, resolve fresh access and are acknowledged only after navigation; [authentication](authentication.md#account-isolation) governs restricted-session continuation.

## Ownership

[The API feature](../packages/api/src/features/notifications) owns eligibility, privacy, claims, retries and registration deletion. [Server adapters](../apps/server/src/notifications) receive only the provider destination and current alert. `apns.ts` and `web-push.ts` use `jose` for signing; Web Push encryption uses `@block65/webcrypto-web-push`. `config.ts` validates providers asynchronously before advertising availability. `worker.ts` composes delivery with the private APNs token cache. [Live services](../apps/server/src/live) own the durable clock, connection tickets and hibernating account hubs.

[Desktop lifecycle](../apps/web/README.md#menu-bar-and-notifications) owns main/panel behavior. Its runtime takes the session lock before the notification lock, guards commands with the window's accepted revision, and captures the OS display epoch before queueing work. A late old display/cleanup must neither adopt a newer account nor clear its alerts. The native smoke feature stubs notifications; it does not test real delivery.

## Configuration

[Server environment schema](../apps/server/.env.schema) owns input formats. `NOTIFICATIONS_ENABLED=true` enables remote providers. Web Push requires the VAPID public/private pair and subject; APNs requires its key, team, topic and matching sandbox/production environment. Missing providers remain unavailable independently. Malformed/partial groups produce a fixed warning naming settings without exposing values. Local key validation cannot establish provider authorization. Desktop socket delivery does not require remote-provider credentials. It requires the process to remain running; OS push for a quit macOS app is a separate platform capability. [Local development](deployment.md#local-development) shows how to enable Web Push for a personal stage.

[Alchemy](../packages/infra/alchemy.run.ts) and the [release workflow](../.github/workflows/release.yml) forward provider configuration separately per environment. Set public configuration as GitHub environment variables and the VAPID/APNs private keys as environment secrets, then redeploy. Leave remote delivery disabled until the matching provider credentials and APNs topic are configured. Private keys must stay server-only. The browser receives only capability status and the VAPID public key.

Retain the VAPID pair across deployments; changing it requires browser re-enrollment. APNs key rotation changes the provider-cache key. Treat cached provider tokens as credentials. Push URLs are restricted by the [provider allowlist](../packages/api/src/features/notifications/endpoints.ts); never allow arbitrary fetch destinations or redirects.

## Operations and checks

Apply every checked-in migration; `db:push` omits required queue triggers/functions. Jobs expire after 24 hours, and daily maintenance removes queue history older than seven days without deleting activity. Unsent files stop being attachable after one day and are swept after two days, keeping physical deletion away from valid sends. Dead destinations are removed; provider authentication/configuration failures retry under the bounded policy without deleting registrations. Logs/statuses must not expose raw provider responses, endpoints, keys or payloads.

Deploy the new migrations and API before distributing updated clients. Existing desktop versions continue their database polling until updated or quit. After release, verify a hidden signed-in desktop, an idle visible browser and a backgrounded iOS app let Neon suspend after its idle timeout. Then send a message and check foreground reconciliation and background delivery. Fault-inject interrupted registration/completion, concurrent writes during a drain, provider acknowledgement loss, reconnects, session revocation and account changes.

From the root:

```sh
bun test packages/api/src/features/notifications packages/api/src/features/live apps/server/src/live apps/server/src/notifications apps/web/tests/notification-navigation.test.ts
```

The [browser suite](../apps/web/README.md#checks) covers worker/account boundaries with fake providers. Before a delivery rollout, use real providers and isolated accounts to check alarm recovery after interruption, expired destinations, permission revocation, logout/account switches, hidden/private content and click authorization. Native delivery requires signed device/bundle checks; browser tests cannot establish it. Test Web Push over HTTPS, including installed iOS Home Screen apps and each configured origin separately.
