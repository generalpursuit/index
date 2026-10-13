# Notifications

Account preferences select message/comment/mention/follow events; each device opts in separately. Categories default on, previews default off. Permission is requested only on explicit enablement. Notification settings do not remove in-app activity, and notifications do not send email.

## Delivery and privacy

Database triggers atomically enqueue references with activity/message writes. Postgres owns the durable queue; Worker memory does not. The one-minute Alchemy Cron Trigger drains a bounded batch using leases and retries; macOS has one process-owned poller. Delivery is **at least once**: provider acceptance and local acknowledgement cannot commit together. Collapse IDs and client deduplication reduce duplicates.

Each delivery and Web Push resolution rechecks the owning session, verified account, current preferences, source existence, membership/visibility, read state and active conversation. The outbox stores references and fixed status codes, not private text. Forwarded-link content is never included in alerts. An OS-accepted alert cannot reliably be recalled after a later privacy change.

Web Push carries only an encrypted job ID. The service worker resolves current content with the session cookie, installation proof and expected session ID; it has no offline content cache. APNs sends only currently permitted content; previews off means generic text throughout the payload. Zero APNs expiration avoids queueing private alerts for offline devices.

Installation proof is distinct from login: every device operation also needs the exact verified session. Account changes reject late enrollment callbacks. Sign-out clears local state without waiting for notification removal. Active-conversation suppression is a short per-device lease, renewed only while focused/foregrounded. Clicks are recipient-bound, resolve fresh access and are acknowledged only after navigation; [authentication](authentication.md#account-isolation) governs restricted-session continuation.

## Ownership

[The API feature](../packages/api/src/features/notifications) owns eligibility, privacy, claims, retries and registration deletion. [Server adapters](../apps/server/src/notifications) receive only the provider destination and current alert. `apns.ts` and `web-push.ts` use `jose` for signing; Web Push encryption uses `@block65/webcrypto-web-push`. `config.ts` validates providers asynchronously before advertising availability. `worker.ts` composes delivery with the private APNs token cache.

[Desktop lifecycle](../apps/web/README.md#menu-bar-and-notifications) owns main/panel behavior. Its runtime takes the session lock before the notification lock, guards commands with the window's accepted revision, and captures the OS display epoch before queueing work. A late old display/cleanup must neither adopt a newer account nor clear its alerts. The native smoke feature stubs notifications; it does not test real delivery.

## Configuration

[Server environment schema](../apps/server/.env.schema) owns input formats. `NOTIFICATIONS_ENABLED=true` enables remote providers. Web Push requires the VAPID public/private pair and subject; APNs requires its key, team, topic and matching sandbox/production environment. Missing providers remain unavailable independently. Malformed/partial groups produce a fixed warning naming settings without exposing values. Local key validation cannot establish provider authorization. Desktop polling does not require remote-provider credentials. [Local development](deployment.md#local-development) shows how to enable Web Push for a personal stage.

[Alchemy](../packages/infra/alchemy.run.ts) accepts these inputs, but the checked-in [release workflow](../.github/workflows/release.yml) does not forward notification settings. Merely adding GitHub environment secrets will not enable remote delivery; arrange their deployment bindings before enabling it. Private keys must stay server-only. The browser receives only capability status and the VAPID public key.

Retain the VAPID pair across deployments; changing it requires browser re-enrollment. APNs key rotation changes the provider-cache key. Treat cached provider tokens as credentials. Push URLs are restricted by the [provider allowlist](../packages/api/src/features/notifications/endpoints.ts); never allow arbitrary fetch destinations or redirects.

## Operations and checks

Apply every checked-in migration; `db:push` omits required queue triggers/functions. Jobs expire after 24 hours, and queue history is removed after seven days without deleting activity. Dead destinations are removed; provider authentication/configuration failures retry under the bounded policy without deleting registrations. Logs/statuses must not expose raw provider responses, endpoints, keys or payloads.

From the root:

```sh
bun test packages/api/src/features/notifications apps/server/src/notifications apps/web/tests/notification-navigation.test.ts
```

The [browser suite](../apps/web/README.md#checks) covers worker/account boundaries with fake providers. Before a delivery rollout, use real providers and isolated accounts to check Cron recovery after interruption, expired destinations, permission revocation, logout/account switches, hidden/private content and click authorization. Native delivery requires signed device/bundle checks; browser tests cannot establish it. Test Web Push over HTTPS, including installed iOS Home Screen apps and each configured origin separately.
