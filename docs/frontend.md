# Web application

The production entry point is `/`.

## Structure

- `apps/web/src/routes/_app`: file routes, validated URL state, authentication guards, and query-backed loaders.
- `src/features/<feature>/hooks`: account-scoped oRPC/TanStack Query queries, pagination, and mutations. Routes and components share cache keys.
- `src/features`: feed, link library, profiles/connections, discovery, activity, and messaging.
- `src/hooks`: small shared hooks for account access, local drafts, debouncing, and history/edge navigation.
- `src/components/app`: navigation and application-level compositions of the shared shadcn Base UI primitives.
- `src/app.css`: responsive application layouts and visual styling. Reusable primitives remain in `packages/ui`.

The weekly feed settles on one viewport-sized week. Native vertical scrolling reveals the adjacent week and snaps into place when the gesture ends; the URL updates only after settling. Adjacent weeks are prefetched, with only the active week available to keyboard and assistive-technology navigation. The friends carousel scrolls horizontally. Empty weeks show a compact add-link invitation and contextual discovery copy, without empty cards or carousel controls. Large collections scroll within their own list, then allow week navigation at the boundary. Every page of links, people, activity, and messages remains accessible through pagination.

URL state holds the selected week, profile group, discovery query, activity filter, and open post. Account-specific API keys prevent sharing cached private results between accounts; sign-out clears queries and drafts. Drafts survive internal navigation in memory and are discarded on reload or account changes.

Forms use TanStack Form with the API's Zod field schemas. Dialogs, menus, select controls, tabs, and avatars use official shadcn Base UI components. Privacy changes require an explicit confirmation dialog. Request errors retain input and provide retry feedback.

Messaging uses exact participant sets for unnamed groups. Selecting recipients queues an attachment in the conversation composer; only pressing Send transmits it. A stable client UUID protects retries. Restricted original posts expose only the original author's public identity. See [API policy](api.md#direct-and-group-messages).

Messages poll every 5 seconds, conversation lists every 10 seconds, and activity every 30 seconds while the app is foregrounded. There is no push or websocket dependency.

## Run and check

Use the root development workflow for the actual application/backend and apply the checked-in database migrations through the existing deployment workflow. In particular, the messaging frontend expects `20261008184316_message_attachments` after `20261008175003_prototype_api`.

```sh
bun run check-types
bun test packages/api/src apps/server/src
cd apps/web
bun run test:e2e
```

Install Playwright's browser once with `bun x --no-install playwright install chromium`.

Playwright starts Vite on port 4173 and a disposable PostgreSQL/PGlite API on port 3002, with real Better Auth and oRPC handlers. It does not read production database credentials or write to the live database. Each test recreates its own fixture data. Coverage includes desktop/mobile layouts, weekly navigation, links/Favorites, profile privacy and follow requests, group management, comment actions, restricted forwards, replies, failed-send recovery, registration, and sign-out isolation.

The test API is a loopback-only test entry point; it is not imported by the application or deployed server. Browser traces and screenshots go to ignored `apps/web/test-results`.
