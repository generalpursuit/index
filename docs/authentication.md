# Email verification and account recovery

Index keeps Better Auth 1.7.7 for password authentication, signed cookies/bearer sessions and password hashing. Email codes prove address ownership or authorize a password reset; they never sign a user in. The email-OTP/passwordless plugin is intentionally not installed. The installed plugin's general-purpose sign-in/check/change routes do not implement Index's session ownership and password-confirmation contract, so `@index/auth/security` supplies a focused Better Auth plugin.

## Session contract

Email/password/name/username signup and email-or-username/password login issue a **restricted** signed session when `user.emailVerified` is false. This includes all preexisting unverified accounts; the migration does not verify them. The existing HttpOnly cookie and signed `set-auth-token` bearer contract is unchanged. Native clients must keep the signed header in their existing API-scoped secure credential store, never the JSON token.

Get-session, sign-out and verification/correction remain available to restricted sessions. Application REST and RPC middleware rejects them with HTTP 403 and `data.code: EMAIL_NOT_VERIFIED`, including public reads supplied with a restricted viewer identity. Anonymous public reads keep their existing visibility rules. Cookie session caching is explicitly disabled: application contexts resolve current database verification/session state, so stale cookie/bearer credentials cannot bypass verification or revocation. No production test bypass exists.

## Endpoints

All paths below are relative to `/api/auth/security`. POST bodies are JSON; GET status requires the existing session. The app uses only explicit trusted origins, while signed native bearer calls need no browser Origin header.

| Endpoint                    | Body                            | Result                                                                                                         |
| --------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET `status`                | —                               | `verification` and `emailChange`, each with email, pending, delivery, retryAfter seconds and expiresAt         |
| POST `send-verification`    | `{}`                            | Send/resend to the session's pending verification address                                                      |
| POST `correct-email`        | `{email,password}`              | Confirm password and send to corrected address, bound to the unverified session                                |
| POST `verify-email`         | `{code}`                        | Verify current challenge; retain current session, revoke other sessions                                        |
| POST `request-reset`        | `{email}`                       | Always `{success:true,retryAfter:60}` for valid addresses, regardless of account/delivery/recipient cooldown   |
| POST `reset-password`       | `{email,code,newPassword}`      | Reset, verify the proven email, revoke **all** sessions and all pending challenges; then sign in with password |
| POST `request-email-change` | `{email,password}`              | Verified session + current password; send to new address, retain old email until proof                         |
| POST `confirm-email-change` | `{code}`                        | Replace email, retain current session, revoke other sessions/challenges                                        |
| POST `change-password`      | `{currentPassword,newPassword}` | Compare current password; replace atomically, revoke other sessions/challenges                                 |

The original signup session owns a correction: supplying an address, user ID or another account's token is insufficient. A later password sign-in can request a fresh challenge for its own session. Resends replace earlier codes. Addresses are only replaced after successful proof; uniqueness collisions do not steal another account's address. Defaults for built-in link verification, reset and email/password change routes are blocked so no alternate path bypasses these rules. Profile updates continue through the application API (and routing's database namespace reservation invariant).

## Persistence and abuse controls

`auth-security.ts` owns `auth_challenge` and `auth_throttle`; migration `20261010095229_auth_email_security` adds these plus PostgreSQL functions. These functions use a consistent account-then-challenge lock order. They commit guess accounting on failure, single-use consumption, verification/password/email writes and session revocation together. This works with Neon HTTP, which does not provide interactive transactions. Concurrent password changes compare the credential hash verified before the transaction. The post-login hook rechecks credentials to close an old-password-login versus reset-revocation race.

Codes are unbiased random six digits, valid for ten minutes, stored only as secret-keyed SHA-256 HMACs bound to their purpose, subject and random nonce. A challenge permits five guesses; the subject has at most 25 guesses/hour, one send/minute, five sends/hour and ten deliveries/hour per recipient. Current-password confirmation permits ten attempts/hour/account. Login permits twenty attempts/ten minutes/identifier. Mutating auth requests also have shared database IP limits (120/ten minutes, and 30 signup/reset deliveries/hour); the production Worker trusts only Cloudflare's edge-supplied IP header. The database limits work across Worker instances. No plaintext code is returned by production endpoints or logged.

Auth traffic schedules `index_auth_cleanup()` at most once every five minutes through a shared SQL maintenance throttle and Worker `waitUntil`. Each pass deletes up to 1,000 challenges and 1,000 throttle keys whose expiry is more than one day old, using `SKIP LOCKED`; active codes/windows are preserved. Unknown-email reset challenges are included. Repeated traffic drains any backlog without unbounded work per request; an idle service creates no new rows. For unusually high sustained traffic, operations may schedule additional calls to the same bounded function. Expiry enforcement never depends on cleanup.

## Delivery and configuration

`RESEND_API_KEY` is server-only. `AUTH_EMAIL_FROM` must be a verified sender (proposed, not provisioned: `Index <accounts@auth.generalpursuit.dev>`). Resend uses its [send-email API](https://resend.com/docs/api-reference/emails/send-email), an idempotency key per challenge and a ten-second request timeout. Provider response bodies and secrets are never included in errors/logs. Failed verification delivery stays restricted and is reported by status; retry after cooldown. A delayed earlier message may contain a superseded code.

Recovery delivery runs in Worker `waitUntil` after an identical response for real/unknown addresses, including delivery failure. A code reset never creates a session. Local tests inject a capture transport; production configuration has no capture flag or code-reading endpoint. The Worker must supply its background task handler when creating auth for HTTP requests.

`CORS_ORIGIN` is the canonical web origin. `AUTH_TRUSTED_ORIGINS` accepts comma-separated additional explicit HTTPS origins, without wildcard hosts or paths. Loopback HTTP is permitted for development. Both auth and server CORS share this allowlist. Packaged Tauri origins remain explicit. Configure the likely canonical `https://i.generalpursuit.dev` and alias `https://index.generalpursuit.dev` only after their hosting is ready; a future dedicated domain uses the same configuration. No domain or credential is embedded as a production default.

Before launch, provision the Resend account, verified sending DNS/SPF/DKIM/DMARC, sending API key, sender, canonical/alias URLs and trusted origins. Exercise actual delivery, spam placement, bounced/delayed messages and provider outage behavior against isolated launch-test accounts. Production email delivery is not verified on this Linux VM.

## Clients and account isolation

Web and Tauri show the same verification screen at `/login`: address, six-digit code, resend cooldown, and password-confirmed correction. Signup stays on that observed session query until verified. Reload/force quit resumes through the signed restricted session and `security/status`; codes and passwords are never persisted in browser storage. Recovery is a separate email/code/new-password flow and finishes at password sign-in. Settings provides current-password change and pending email-change verification.

An account transition synchronously replaces cached session data with null while retaining the active query/observer, cancels account queries, and clears the mutation cache. Application mutations and browser/native transport responses carry account generations, including checks after asynchronous response-body parsing and secure-token writes. Old success/rollback callbacks cannot repopulate another account's cache. Drafts are keyed by viewer identity and are discarded at transitions. A successful sign-out still navigates to login when session revalidation fails. Same-account `refreshSession` preserves identity during security updates. Device theme preference is independent of these caches.

SwiftUI has a restricted root with verification/correction and a recover-password sheet. APIClient keeps signed credentials in the existing API-scoped Keychain; a verification-required error clears content but preserves the restricted credential. Reset revokes and erases it. `verifiedSessionRevision` advances on each verified session acceptance; the root observes it to resume pending readable URLs, including false-to-true verification for the same ID. A pending URL binds to the account that accepts it and is discarded on sign-out/account switch. Anonymous incoming links survive initial restoration and subsequent signup. Private route resolution always checks a fresh verified session.

## Local verification and remaining launch checks

All automated data is disposable PGlite/fixture data. Server tests use real Better Auth handlers, signed cookies and signed bearer tokens, the checked-in SQL migrations, REST and RPC handlers, and the production Hono authentication mounting function with an execution-context `waitUntil` spy. They cover the full verification/recovery/change lifecycle, restricted/legacy/stale sessions, resolver gates, atomic guesses/consumption, correction ownership, namespace reservations, delivery failure, reset enumeration/revocation, and bounded cleanup. This tests the actual Worker delivery wiring, but does not claim a deployed Cloudflare Worker or real Resend delivery was exercised.

Run from the repository root with the declared Bun version:

```sh
bun test apps/server/src packages/api/src apps/web/tests
(cd apps/server && bun run check-types && bun run build)
(cd apps/web && bun run check-types)
E2E_API_PORT=3502 E2E_WEB_PORT=4673 bun --cwd apps/web run test:e2e security.spec.ts desktop.spec.ts readable-routes.spec.ts
```

On this Linux VM, headed Chromium with a fresh owned Xvfb display is required. The rollout's finite runner uses the assigned ports and cleans only its own display/processes. A mocked Tauri bridge exercises real bearer signup/verification/reload/revocation through the fixture backend; it does not validate macOS Keychain or a packaged Tauri app.

On the user's Mac, run `swift test` and `swift build` in `apps/ios`, then the simulator build in its README and the disposable native integration tests. Verify interrupted signup, corrected address, wrong/expired code, resend cooldown, recovery, current-password/email changes, offline sign-out, old-session rejection, and pending deep links across same-ID verification and account switches. Check iPhone/iPad keyboard/one-time-code autofill, VoiceOver, Dynamic Type and System/Light/Dark; launch the signed Tauri build and check Keychain restore/erase there too. Swift/Xcode, signing, simulator/device checks and real delivery were **not run on this Linux VM**. Earlier native validation recorded elsewhere was on another Mac and does not validate these changes.

For native verification with this feature's isolated ports, start `E2E_API_PORT=3502 bun e2e/server.mjs` from `apps/web` in a separate terminal, with no browser runner using that fixture. On the Mac:

```sh
cd apps/ios
swift test
swift build
INDEX_NATIVE_INTEGRATION=1 INDEX_NATIVE_TEST_PORT=3502 swift test
xcodebuild -project Index.xcodeproj -scheme Index \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO \
  INDEX_API_URL=http://localhost:3502 INDEX_WEB_URL=http://localhost:4673 build
cd ../web
VITE_SERVER_URL=http://localhost:3502 bun run desktop:build --local --bundles app
open -n src-tauri/target/release/bundle/macos/Index.app
```

### Recorded verification for this feature (Linux, 2026-10-10)

The combined branch passed 134 server/API/web unit tests, three additional Resend transport tests, and three infrastructure configuration tests. The focused production browser run passed all 27 auth/desktop/routes/Settings/theme/bootstrap cases (58.3s), followed by the existing registration/return-destination case (1/1). The earlier dev-mode run passed 22 cases but incorrectly included five production-only pre-app CSS checks; those five passed on the built production bundle without a product workaround.

Web and server production builds, server/web/shared-UI/infrastructure types, and scoped auth lint passed. Checked-in migrations apply from empty and seeded legacy databases; Drizzle reports no schema changes. The snapshot chain is initial → readable routes → auth email security, preserving both migrations' custom functions/triggers. Xcode project generation is reproducible and Info.plist parses; these structural checks are not native compilation or execution. No production deployment, real database/account, provider credential or sending domain was used.
