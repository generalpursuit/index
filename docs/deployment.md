# Deployment

One Alchemy stack deploys the API Worker, Vite web Worker, Neon project, and private R2 photo bucket. `staging` and `production` own independent resources and state. Personal development stages keep their existing resource names.

| Branch    | Stage        | Web                                               | API                                               |
| --------- | ------------ | ------------------------------------------------- | ------------------------------------------------- |
| `staging` | `staging`    | `index-staging-web.generalpursuit.workers.dev`    | `index-staging-api.generalpursuit.workers.dev`    |
| `main`    | `production` | `index-production-web.generalpursuit.workers.dev` | `index-production-api.generalpursuit.workers.dev` |

## GitHub Actions

`.github/workflows/ci.yml` runs formatting, lint, API/server/infra tests, type checks, a web build, and Chromium tests against the built web app and disposable database. It runs on pull requests and is reused by deployment. It needs no provider credentials.

`.github/workflows/deploy.yml` runs on pushes to `main` and `staging`, and supports manual dispatch from those branches. Checks must pass first. The deploy job uses the matching GitHub environment. Each branch has its own concurrency group; an in-progress deploy is never cancelled by a newer push. Manual dispatch from other branches is skipped.

The environment's deployment branch policy permits only `main` for production and `staging` for staging. Branch protection is separate; if the repository's GitHub plan supports it, require the CI checks and PR review on `main`.

After deploying, read-only smoke checks verify the web page, JavaScript assets, SPA routing, a database-backed API read, exact CORS origin, and the anonymous auth session endpoint. URLs are recorded in the run summary. Browser test failures upload screenshots/traces for seven days.

## One-time account setup

Enable Workers and R2 in Cloudflare, and connect Cloudflare and Neon with `alchemy profile edit` from `packages/infra`. Keep Alchemy at the version pinned in the lockfile. CI uses Bun 1.4.2 and `bun install --frozen-lockfile`.

`packages/infra/setup-github.ts` configures both GitHub environments and their branch policies with the authenticated GitHub CLI. It then runs `github.run.ts`, an Alchemy administrative stack that manages a separate Cloudflare API token per environment and the environment secrets/variables. Run this locally, never in the app deployment job. The CLI bootstrap avoids an Alchemy beta.80 bug that submits unsupported reviewer settings even when none are requested:

```sh
cd packages/infra
# Supply NEON_API_KEY and WORKERS_SUBDOMAIN through the environment.
# GitHub authentication can use the authenticated gh CLI or GITHUB_TOKEN.
bun run setup:github --yes
```

The `admin` Alchemy profile must be able to create account API tokens and access the Cloudflare state store. App deployment tokens have Workers Scripts Write, R2 Storage Write, Account Settings Read, Secrets Store Write, and Workers Tail Read; they cannot mint other tokens. Cloudflare scopes these permissions to the account, so the two tokens are separate credentials, not a hard account boundary.

Each GitHub environment contains:

- Secrets: `CLOUDFLARE_API_TOKEN`, `NEON_API_KEY`.
- Variables: `CLOUDFLARE_ACCOUNT_ID`, `WORKERS_SUBDOMAIN`.
- Optional variables: `WEB_DOMAIN`, `API_DOMAIN` (hostnames without a scheme or path).
- Authentication email: secret `RESEND_API_KEY`, variable `AUTH_EMAIL_FROM`, and optional variable `AUTH_TRUSTED_ORIGINS`. The deployment workflow passes these to Alchemy, which installs the sending key as a server-only Worker secret.

The existing Neon organization API key is used for project provisioning. GitHub environment separation controls which deployment job receives it; it is not a project-scoped key.

Alchemy generates a separate `auth-secret` resource for each release stage. Its random value is persisted in encrypted cloud state and passed to the API as a secret binding. It is not regenerated on deploy or exposed as a stack output. Local development still uses `BETTER_AUTH_SECRET` from the server environment.

## URLs and local deploys

`WORKERS_SUBDOMAIN` is the account prefix before `.workers.dev` (`generalpursuit` for this account). Release Worker names are stable, so the API can derive the exact frontend origin before the web Worker is deployed. `BETTER_AUTH_URL` follows the API's own URL; Vite receives that API URL during its build. No first-deploy/redeploy CORS workaround is required.

```sh
cd packages/infra
WORKERS_SUBDOMAIN=generalpursuit bun run deploy --stage staging --yes
WORKERS_SUBDOMAIN=generalpursuit bun run smoke -- staging
```

Use `--stage production` for production. Always spell out the stage. `prod` would be a different environment, and CI rejects unrecognized stages. Do not run `alchemy dev` against a release stage.

To attach custom domains later, configure `WEB_DOMAIN` and `API_DOMAIN` in the corresponding GitHub environment and redeploy. The zones must exist in the Cloudflare account, and deployment credentials will also need the domain/zone permissions. Never put credentials in `VITE_` variables: they are public browser configuration.

## Database changes and recovery

Generate migrations locally with Drizzle and commit the SQL. Applied migration files are immutable, including the initial migration; add new migrations instead of regenerating or squashing them. Alchemy applies the checked-in migrations before deploying the API that depends on the database. There is no separate `drizzle-kit migrate` or `db:push` step in CI. Promote the same migration files from staging to main; staging data is never copied into production.

Use additive, backward-compatible migrations while an old API version may still be running. Restoring an older app commit does not undo database changes. To roll back code, revert the offending change and let the regular workflow redeploy; handle incompatible database changes with a forward migration or deliberate restore.

Production's Neon project and R2 bucket use Alchemy's `retain` removal policy. This keeps their physical data if a declaration is removed or the stage is destroyed, but Alchemy then stops tracking that resource; recovery/adoption must be deliberate. The shared Cloudflare state store must be preserved as well.

Neon history retention remains at the existing six-hour setting. A longer production recovery window should be chosen within the account's plan before relying on this for customer data. Retention does not replace testing a restore or arranging an independent backup when needed.

Bootstrap staging first, verify its smoke checks, then deploy production. Do not seed production with end-to-end fixtures. Cloudflare Worker logs are enabled by Alchemy; an external alerting service is not configured by this setup.

## Email verification launch configuration

For local Alchemy development, put `RESEND_API_KEY` and `AUTH_EMAIL_FROM` in the Git-ignored `packages/infra/.env.local`, then restart the development process. A repository-root `.env.local` is not loaded by this package: Bun's automatic env loading is disabled, and Varlock loads the owning package's schema and env files. A local env file also does not update an already deployed Worker.

For a first inbox test, use `AUTH_EMAIL_FROM="Index <onboarding@resend.dev>"` and the email address associated with your Resend account as the recipient. Resend's shared test domain cannot send to arbitrary recipients; see its [testing restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain). For staging or production, configure the corresponding GitHub environment's secret and sender variable, then deploy that environment. Verify a domain you own before testing other recipients.

See [authentication](authentication.md) before launching these changes. Provision a Resend account, sender DNS and a server-only `RESEND_API_KEY`; configure `AUTH_EMAIL_FROM` and `AUTH_TRUSTED_ORIGINS` for the chosen canonical/alias origins. Proposed addresses/domains are not provisioned defaults. The application issues restricted sessions to all unverified accounts, including legacy users, and requires email proof before app access; deploy only when delivery is configured and tested. The auth migration must follow `20261010095101_readable_routes` and applies without marking old accounts verified.
