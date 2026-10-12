# Deployment

[Alchemy](../packages/infra/alchemy.run.ts) owns the API Worker, Vite web Worker, Neon database and private R2 photo bucket. `staging` and `production` have independent resources and state. Their branch mapping lives in [deployment.ts](../packages/infra/deployment.ts): `staging` deploys staging; `main` deploys production. Worker names are `index-<stage>-web` and `index-<stage>-api` under the configured `WORKERS_SUBDOMAIN`.

## Local development

Install the pinned Bun dependencies from the root with `bun install --frozen-lockfile`. Enable Cloudflare Workers/R2 and configure Cloudflare/Neon access through the installed Alchemy CLI:

```sh
cd packages/infra
bun run alchemy profile edit
```

Set a development `BETTER_AUTH_SECRET` of at least 32 characters in the ignored `packages/infra/.env.local`. Set `RESEND_API_KEY` and `AUTH_EMAIL_FROM` there for verification email. Consult the [infra schema](../packages/infra/.env.schema) and [server schema](../apps/server/.env.schema) for inputs. Bun's automatic dotenv loading is disabled; Varlock loads the owning package's files, not a root `.env.local`. Restart development after changes.

From the root, `bun dev` runs Alchemy with web on port 3000 and API on 8080, supplying database, auth URL, media and frontend API bindings. Use a personal stage for development; never run Alchemy development against a release stage. [Browser fixtures](../apps/web/README.md#checks) provide a disposable backend for tests without these cloud credentials.

## Release deployment

[deploy.yml](../.github/workflows/deploy.yml) runs reusable [CI](../.github/workflows/ci.yml) before deployment and serializes each release branch without cancelling an active deploy. It uses the matching GitHub environment. The checked-in workflow is the input inventory; environment configuration does not affect an already deployed Worker until redeployment.

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

Substitute `production` in **both** commands for production. Always spell out the stage: `prod` is a different environment. Smoke checks cover web assets, SPA routing, a database read, exact CORS origin and anonymous auth.

Custom `WEB_DOMAIN` / `API_DOMAIN` values are hostnames, requiring configured zones and deployment permissions. Auth uses the API URL; the frontend build receives it from Alchemy. Never place credentials in public `VITE_` variables. Desktop channel URLs are separately owned by [desktop-channels.mjs](../apps/web/scripts/desktop-channels.mjs); coordinate a domain change with desktop releases.

Verification email requires a server-only Resend key and a verified sender. Restricted accounts cannot use the app until email proof succeeds: test actual delivery before release. Configure canonical/alias origins explicitly; no proposed domain or sender is automatically provisioned. See [authentication](authentication.md) and [notification configuration](notifications.md#configuration).

## Database and recovery

Generate a new migration with `bun run db:generate` from the root and commit its SQL. **Applied migrations are immutable**, including the initial migration. Preserve custom functions/triggers; `db:push` cannot replace them. Alchemy applies the checked-in migrations before deploying the dependent API. Promote identical files from staging to production; never copy fixture/staging data into production.

Keep migrations compatible with an older API still running. To roll back application code, revert the change and redeploy through the regular workflow. Code rollback does not undo schema changes: use a forward migration or a deliberate database restore.

Production Neon and R2 resources use `retain` on removal. Their data survives a removed declaration or destroyed stage, but Alchemy stops tracking them; recovery requires deliberate adoption. Preserve the shared Cloudflare state store as well. Neon history retention is currently six hours; establish and test the required recovery window/backups before depending on it.
