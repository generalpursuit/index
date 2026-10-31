# Authentication and account isolation

Better Auth owns password hashing and signed sessions. [security-plugin.ts](../packages/auth/src/security-plugin.ts) adapts `/api/auth/security` endpoints to [security.ts](../packages/auth/src/security.ts) account operations. Endpoint details are available in the [auth OpenAPI document](api.md). Email codes prove ownership or authorize recovery; they never sign a user in. Built-in alternate verification/reset/change routes are blocked to preserve this contract.

## Sessions

Unverified accounts, including legacy accounts, receive restricted sessions. Get-session, sign-out and verification/correction remain available; application REST/RPC rejects the identity with HTTP 403 and `EMAIL_NOT_VERIFIED`, including otherwise-public reads. Anonymous reads retain normal visibility. Resolve current database session and verification state on API requests; cookie session caching is disabled. Idle clients do not run session-check timers. Live connections use one-use tickets minted after verified authentication, enforce their session expiry before sending hints, and close on committed session revocation. Hints carry no content; subsequent reads still authorize against current database state.

Native clients keep the signed **`set-auth-token` header**, replace it on rotation, and send it as a bearer credential. Never store the unsigned JSON token. Use API-scoped secure storage, erase credentials on expiry/sign-out, and follow the [shared Keychain contract](sharing.md#secure-hostextension-session-boundary) for extensions. Restricted sessions retain their credential while private content clears.

Verification/correction challenges belong to the requesting session. Address correction and account changes require the current password; the proven credential hash participates in the atomic update. Email stays unchanged until ownership is proven. Verification, password change and email change revoke other sessions; password reset verifies the address and revokes **all** sessions, then requires password sign-in. Reset responses do not reveal whether an address exists or delivery succeeded.

Codes expire, are single-use, and are stored as purpose/subject-bound HMACs. Database functions commit failed-guess accounting, challenge consumption, account changes and revocation atomically. Shared account/IP/recipient throttles apply across Workers. Preserve these functions when adding migrations. Auth traffic schedules bounded cleanup through Worker `waitUntil`; expiry checks never depend on cleanup.

## Account isolation

An account transition clears private queries, mutation state, drafts and navigation immediately. Async requests, parsed response bodies, token writes and success/rollback callbacks must still belong to the accepted account generation before publishing results. Transient refresh failures can preserve authorized cached data; forbidden/not-found responses must hide it. Device appearance is independent of account caches.

Pending native routes/clicks are recipient-bound. They may survive restricted-to-verified transitions for the same account, but must resolve against a fresh verified session before navigation or acknowledgement. Sign-out/account changes discard them. Desktop windows also obey the [native revision boundary](../apps/web/README.md#desktop-session-boundary).

## Delivery and checks

Configure server-only `RESEND_API_KEY`, a verified `AUTH_EMAIL_FROM`, and the explicit web origins in [deployment](deployment.md). `CORS_ORIGIN` is canonical; `AUTH_TRUSTED_ORIGINS` adds explicit HTTPS origins, with loopback HTTP allowed in development. The server and auth share that allowlist. Packaged Tauri origins are explicit; bearer requests need no browser Origin header.

Recovery delivery uses Worker `waitUntil` after its uniform response. Failed verification delivery leaves a restricted session and retry status; an older delayed message may contain a superseded code. No production code-reading endpoint or capture mode exists.

Run `bun test apps/server/src packages/api/src apps/web/tests` from the root. The [browser checks](../apps/web/README.md#checks) use disposable auth fixtures. Before enabling real email delivery, check verified-sender delivery, delay/outage, recovery and revocation with isolated accounts. [Native checks](../apps/ios/README.md#checks) must also cover interrupted verification, offline sign-out and pending links across account changes.
