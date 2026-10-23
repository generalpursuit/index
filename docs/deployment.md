# Deployment

[Alchemy](../packages/infra/alchemy.run.ts) owns the API Worker, Vite web Worker, Neon database and private R2 buckets for profile photos and message files. `staging` and `production` have independent resources and state. Both release from `main`; [deployment.ts](../packages/infra/deployment.ts) names the stages, and the release workflow's input picks one. Worker names are `index-<stage>-web` and `index-<stage>-api` under the configured `WORKERS_SUBDOMAIN`.

## Local development

Install the pinned Bun dependencies from the root with `bun install --frozen-lockfile`. Enable Cloudflare Workers/R2 and configure Cloudflare/Neon access through the installed Alchemy CLI:

```sh
cd packages/infra
bun run alchemy profile edit
```

Set a development `BETTER_AUTH_SECRET` of at least 32 characters in the ignored `packages/infra/.env.local`. Set `RESEND_API_KEY` and `AUTH_EMAIL_FROM` there for verification email. Consult the [infra schema](../packages/infra/.env.schema) and [server schema](../apps/server/.env.schema) for inputs. Bun's automatic dotenv loading is disabled; Varlock loads the owning package's files, not a root `.env.local`. Restart development after changes.

To try browser notifications, also set `NOTIFICATIONS_ENABLED=true`, a VAPID key pair and a `VAPID_SUBJECT` such as `mailto:you@example.com` there. Create the pair once with Bun's WebCrypto and keep it; a new pair means enabling notifications again in each browser:

```sh
bun -e '
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const raw = Buffer.from(await crypto.subtle.exportKey("raw", publicKey));
const { d } = await crypto.subtle.exportKey("jwk", privateKey);
console.log(`VAPID_PUBLIC_KEY=${raw.toString("base64url")}\nVAPID_PRIVATE_KEY=${d}`);
'
```

Browsers treat `http://localhost` as secure, and development runs the one-minute cron locally; it delivers notifications and sweeps unsent message files. Leave the `APNS_*` inputs unset: Apple push needs a real Apple key and a signed app with the push entitlement, so a local stage reports it unavailable.

From the root, `bun dev` runs Alchemy with web on port 3000 and API on 8080, supplying database, auth URL, media, message-file and frontend API bindings. Use a personal stage for development; never run Alchemy development against a release stage. [Browser fixtures](../apps/web/README.md#checks) provide a disposable backend for tests without these cloud credentials.

## Release deployment

[release.yml](../.github/workflows/release.yml) runs only on manual dispatch: merging does not release. Run it from the Actions tab on `main` and choose the `staging` or `production` stage; runs from other branches fail before anything deploys. One run releases the API, web and [desktop apps](desktop-releases.md) under one version after reusable [CI](../.github/workflows/ci.yml). It serializes each stage without cancelling an active run, and each job uses the matching GitHub environment. The checked-in workflow is the input inventory; environment configuration does not affect an already deployed Worker until redeployment.

The root [package.json](../package.json) `version` is the product version. Staging releases it as `X.Y.Z-staging.<run>` without a bump. Production releases exactly `X.Y.Z`: [release.ts](../packages/infra/release.ts) refuses to start unless it is higher than the latest `vX.Y.Z` tag, which the workflow creates only after every part is published. Bump the version before a production release, and regenerate the iOS project with `python3 apps/ios/Scripts/generate-project.py`.

The API and web deploy together once checks pass; desktop builds run alongside, and their update feed advances only after the deployment. Keep the API compatible with the previous release's clients: desktop apps update silently, but iOS updates and open browser tabs lag. To drop older clients, follow [client versions](api.md#client-versions).

The administrative `setup:github` command in `packages/infra` maintains the two environments, branch policies and separate Cloudflare deployment tokens. Run it locally with authenticated `gh`, the `admin` Alchemy profile, `NEON_API_KEY` and `WORKERS_SUBDOMAIN` available:

```sh
cd packages/infra
bun run setup:github --yes
```

This administrative stack can mint tokens; app deployment tokens cannot. Environment separation is not a separate Cloudflare account or a project-scoped Neon credential. Release auth secrets are generated once per stage and retained in encrypted Alchemy state.

For a manual deployment, supply deployment credentials and `WORKERS_SUBDOMAIN` in the environment, then:

```sh
cd packages/infra
bun run deploy --stage staging --yes
bun run smoke -- staging
```

Substitute `production` in **both** commands for production. Always spell out the stage: `prod` is a different environment. Smoke checks cover web assets, redirects, SPA routing, a database read, exact CORS origin and anonymous auth.

Custom `WEB_DOMAIN` / `API_DOMAIN` values are hostnames in a zone of the deployment account; `WEB_REDIRECT_DOMAINS` lists hostnames that 301 to `WEB_DOMAIN`. Set web and API domains together under one registrable domain: `workers.dev` is a public suffix, so a custom web domain calling a `workers.dev` API is cross-site and browsers such as Safari drop the session cookie. Workers stay reachable at `workers.dev`, so released native apps and stored photo addresses keep working after a move. Only production's deployment token can manage zones, so other stages keep `workers.dev`. After moving the web origin, list the previous one in `AUTH_TRUSTED_ORIGINS`: it still serves open tabs and older links. Auth uses the API URL; the frontend build receives it from Alchemy. Never place credentials in public `VITE_` variables. Desktop channel URLs are separately owned by [desktop channel configuration](../apps/web/scripts/desktop/channels.ts); coordinate a domain change with desktop releases.

Verification email requires a server-only Resend key and a verified sender. Restricted accounts cannot use the app until email proof succeeds: test actual delivery before release. Configure canonical/alias origins explicitly; no proposed domain or sender is automatically provisioned. See [authentication](authentication.md) and [notification configuration](notifications.md#configuration).

## Database and recovery

Generate a new migration with `bun run db:generate` from the root and commit its SQL. **Applied migrations are immutable**, including the initial migration. Preserve custom functions/triggers; `db:push` cannot replace them. Alchemy applies the checked-in migrations before deploying the dependent API. Promote identical files from staging to production; never copy fixture/staging data into production.

Keep migrations compatible with an older API still running. To roll back application code, revert the change and redeploy through the regular workflow. Code rollback does not undo schema changes: use a forward migration or a deliberate database restore.

Set the internal `"user".is_discoverable` flag to false for retained operational accounts, such as Apple's app-review account, that should stay out of people discovery and connection lists. New accounts default to true; account/profile APIs cannot change the flag. Set it by immutable user ID in the intended stage's database. This setting preserves sign-in and direct account access and is independent of email verification and profile privacy. Disposable production probes should be deleted after checking their dependent rows and stored files.

Production Neon and R2 resources use `retain` on removal. Their data survives a removed declaration or destroyed stage, but Alchemy stops tracking them; recovery requires deliberate adoption. Preserve the shared Cloudflare state store as well. Neon history retention is currently six hours; establish and test the required recovery window/backups before depending on it.
