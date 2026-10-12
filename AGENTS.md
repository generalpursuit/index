# Repository guide

Index is a Bun monorepo. Use the version in `package.json` and the lockfile.

- `apps/web`: React frontend and Tauri host; [development and ownership](apps/web/README.md).
- `apps/server`: Hono composition and Cloudflare Worker bindings/transports.
- `packages/api`: feature contracts, application operations and query repositories.
- `packages/auth`: Better Auth integration and account-security operations.
- `packages/db`: Drizzle schema and immutable migration history.
- `packages/ui`: presentation primitives, styling and fonts; no app/account dependencies.
- `packages/infra`: Alchemy development, deployment and recovery.
- `apps/ios`: SwiftUI, `IndexCore` transport, `IndexFeatures` state and shared native UI/extensions; [native guide](apps/ios/README.md).
- `assets/brand`: canonical artwork and generation; follow its [README](assets/brand/README.md).

## Critical rules

Apply visibility before pagination/counts. Preserve signed native token headers, account/cache isolation, and immutable IDs/payloads for uncertain retries. Use [API](docs/api.md), [auth](docs/authentication.md), [sharing](docs/sharing.md) and [route](docs/readable-routes.md) contracts when touching those boundaries.

Never rewrite applied migrations or replace their custom SQL with `db:push`. Keep staging/production resources and desktop channels separate. Read [deployment](docs/deployment.md) or [desktop releases](docs/desktop-releases.md) before operational changes.

Check the affected workspaces; common commands are in [README](README.md). Browser fixtures are disposable and must not be reset concurrently by native tests. Native behavior needs its platform tooling; source checks are not native execution.

Keep docs about durable constraints, ownership and reproducible operations. Endpoint inventories belong to generated OpenAPI in `apps/server/src/transport.ts`; omit task histories and recorded test counts. Read other [guides](docs/README.md) on demand.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
