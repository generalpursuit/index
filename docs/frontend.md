# Web application

The production entry point is `/`.

## Structure

- `apps/web/src/routes/_app`: file routes, validated URL state, authentication guards, and query-backed loaders.
- `src/features/<feature>/hooks`: account-scoped oRPC/TanStack Query queries, pagination, and mutations. Routes and components share cache keys.
- `src/features`: feed, link library, profiles/connections, discovery, activity, and messaging.
- `src/hooks`: small shared hooks for account access, local drafts, debouncing, and history/edge navigation.
- `src/components/app`: navigation and application-level compositions of the shared shadcn Base UI primitives.
- `src/app.css`: responsive application layouts and visual styling. Reusable primitives remain in `packages/ui`.

The weekly feed settles on one viewport-sized week. Native vertical scrolling reveals the adjacent week and snaps into place when the gesture ends; the URL updates only after settling. Adjacent weeks are prefetched, with only the active week available to keyboard and assistive-technology navigation. Weeks without links from you or your people are skipped. The stationary header shows the selected week number in Source Serif 4 Display bold and updates after scrolling settles. Only the content beneath it scrolls; each week shows your links above your people's, without visible section labels (screen readers still get them). Every row's marker column is as wide as an avatar, so markers center under people and titles start where their names do. The friends carousel scrolls horizontally; its arrows, like the newer-week arrow, appear only when there is somewhere to go. Friend cards end after their last link. Empty sections show one line of add-link or discovery copy. Links show a colored marker for their server-assigned category instead of an icon. A row's title opens the post and its domain opens the website; favorites, forwarding, editing and deleting live in the post view. A profile shows the avatar, name and one line of facts, with Settings (including profile visibility and sign-out) behind the gear. Below it, one text row filters your links by All, Favorites and your groups, then a separator and Starred (other people's links you saved). Lock and edit controls for the selected list are pinned at the right end of that row, so selecting a list never shifts the filters. Weeks keep their serif title with the dates as a small label beside it. Modals are one shared component: a centered dialog on larger screens and a swipeable bottom sheet on phones (Base UI Drawer), with serif titles and one primary action in a footer; confirmations stay small centered dialogs. The current week's first row is an “Enter a link” field: pasting a link, or typing one and pressing Enter, saves it immediately. The server reads its title and category; until then a pending row with an outlined marker shows, and it turns into the saved row in place. The confirmation offers Undo. It is hidden on phones, where the bottom bar's “+” is the way in. Adding with full control or editing a link opens a modal over the current page via the `add` (true or a group to preselect) and `edit` search parameters, next to the existing `post` parameter. It starts with a single “Paste a link” field; a valid web URL reveals a live preview row (with the category the server will assign), title, note and a group choice that says who will see the link. Editing uses the same form with everything shown. Links without a group follow the profile's visibility; only locked groups hide links further. Friends appear as two columns of the same rows. Large collections scroll within their own list, then allow week navigation at the boundary. Every page of links, people, activity, and messages remains accessible through pagination.

URL state holds the selected week, profile group, discovery query, activity filter, and open post. Account-specific API keys prevent sharing cached private results between accounts; sign-out clears queries and drafts. Drafts survive internal navigation in memory and are discarded on reload or account changes.

Activity uses the same display typography as the weekly feed and Discover. Its filters are All, Comments, Requests, Mentions and Follows; acceptance events remain in All. Typing `@username` in a comment notifies readers who can access that post, and the notification opens the original thread.

Your own profile’s gear opens `/settings` on desktop and mobile. Settings owns name, username, image URL (with preview and removal), and sign out; navigation and profile lists do not expose a separate sign-out action. Saves retain input on failure and refresh profile/session data on success. The SwiftUI client uses the same Settings entry.

Forms use TanStack Form with the API's Zod field schemas. Dialogs, menus, select controls, tabs, and avatars use official shadcn Base UI components. Privacy changes require an explicit confirmation dialog. Request errors retain input and provide retry feedback.

Messaging uses exact participant sets for unnamed groups. Selecting recipients queues an attachment in the conversation composer; only pressing Send transmits it. A stable client UUID protects retries. Restricted original posts expose only the original author's public identity. See [API policy](api.md#direct-and-group-messages).

Messages poll every 5 seconds, conversation lists every 10 seconds, and activity every 30 seconds while the app is foregrounded. There is no push or websocket dependency.

## Run and check

Use the root development workflow for the actual application/backend and apply the checked-in database migrations through the existing deployment workflow.

```sh
bun run check-types
bun test packages/api/src apps/server/src
cd apps/web
bun run test:e2e
```

Install Playwright's browser once with `bun x --no-install playwright install chromium`.

Playwright starts Vite on port 4173 and a disposable PostgreSQL/PGlite API on port 3002, with real Better Auth and oRPC handlers. It does not read production database credentials or write to the live database. Each test recreates its own fixture data. Coverage includes desktop/mobile layouts, weekly navigation, links/Favorites, profile privacy and follow requests, group management, comment actions, restricted forwards, replies, failed-send recovery, registration, and sign-out isolation.

The test API is a loopback-only test entry point; it is not imported by the application or deployed server. Browser traces and screenshots go to ignored `apps/web/test-results`.
