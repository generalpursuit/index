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

Expired rows can be purged with `DELETE FROM auth_challenge WHERE expires_at < now() - interval '1 day'` and the corresponding query on `auth_throttle`. Retain current windows when scheduling operational cleanup. Cleanup is not required for expiry enforcement.

## Delivery and configuration

`RESEND_API_KEY` is server-only. `AUTH_EMAIL_FROM` must be a verified sender (proposed, not provisioned: `Index <accounts@auth.generalpursuit.dev>`). Resend uses its [send-email API](https://resend.com/docs/api-reference/emails/send-email), an idempotency key per challenge and a ten-second request timeout. Provider response bodies and secrets are never included in errors/logs. Failed verification delivery stays restricted and is reported by status; retry after cooldown. A delayed earlier message may contain a superseded code.

Recovery delivery runs in Worker `waitUntil` after an identical response for real/unknown addresses, including delivery failure. A code reset never creates a session. Local tests inject a capture transport; production configuration has no capture flag or code-reading endpoint. The Worker must supply its background task handler when creating auth for HTTP requests.

`CORS_ORIGIN` is the canonical web origin. `AUTH_TRUSTED_ORIGINS` accepts comma-separated additional explicit HTTPS origins, without wildcard hosts or paths. Loopback HTTP is permitted for development. Both auth and server CORS share this allowlist. Packaged Tauri origins remain explicit. Configure the likely canonical `https://i.generalpursuit.dev` and alias `https://index.generalpursuit.dev` only after their hosting is ready; a future dedicated domain uses the same configuration. No domain or credential is embedded as a production default.

Before launch, provision the Resend account, verified sending DNS/SPF/DKIM/DMARC, sending API key, sender, canonical/alias URLs and trusted origins. Exercise actual delivery, spam placement, bounced/delayed messages and provider outage behavior against isolated launch-test accounts. Production email delivery is not verified on this Linux VM.
