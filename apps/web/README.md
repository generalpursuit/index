# Web and desktop development

React, TanStack Router/Query and Tauri share one frontend. Run `bun dev` from the root after [local setup](../../docs/deployment.md#local-development); web is on port 3000 and the Alchemy API on 8080. `bun dev:server` selects that same infrastructure task, including its web companion, because the API requires Worker bindings. `bun run --cwd apps/server build` produces the Worker bundle.

## Ownership

- [Routes](src/routes) own URL state, guards and loaders. [Features](src/features) own queries, mutations, drafts and product behavior; loaders and hooks share query options.
- [App components](src/components/app) own navigation, account-model avatars, week controls and query presentation. Forbidden/not-found results hide content; transient refresh failures can retain usable data.
- [Shared UI](../../packages/ui/src) owns accessible primitives, responsive Modal/Confirmation, control styling, tokens and fonts. It has no app routes, API models, account state or native bridge dependencies. Features own layout and product-specific controls.
- [Data](src/data) owns the query client, account persistence, RPC batching, pulse, summary seeding and instant-edit transactions. Features own payloads and patches. Loaders await missing primary data; cached data opens immediately and secondary reads run in the background. The shell follows the component on screen, including its pending view. Rows and dialogs use their real components while loading.
- Groups own complete-list/selection reconciliation; sharing owns the save destination; links own weekly link presentation; messages own conversation presentation and immutable send attempts. Profile list chips are links to [readable routes](../../docs/readable-routes.md), so the URL alone selects a list. [Retry rules](../../docs/api.md#messages-and-retries) and [account isolation](../../docs/authentication.md#account-isolation) apply across navigation and awaited callbacks.

## Loading and caching

Follow [the shared loading contract](../../docs/data-loading.md). Content refreshes on show after 30 seconds; notification preferences and capabilities use five minutes. Conversations, messages and activity follow one pulse while visible, every 15 seconds or three seconds in a focused conversation. A changed version refreshes the newest page. Overlapping pages retain loaded history; disconnected pages restart at the newest cursor so loading more cannot skip arrivals. Navigation nudges the same account clock, and message edits defer version acceptance until their reads can be applied. A server without pulse falls back to unread reads and the same refresh path.

IndexedDB content belongs to one API scope and verified account, with an app/format buster and a seven-day age limit. A remembered identity restores that account before the first router load, then revalidates silently. Desktop restore also requires the accepted native revision. Credentials, session responses, drafts, searches, security state and device notification state are excluded. Message file bytes are cached in memory only, under the viewer, outside content features, and are never batched. Account clearing stops queued writes immediately and attempts erasure before another account is accepted. Storage failures leave a network-only session and never block sign-in. Account clearing also blocks disk restore until a verified network session successfully binds its cache again, so failed erasure cannot revive signed-out content. Browser tabs announce account boundaries, and each disk write checks the shared account marker. Confirmed edits flush before completion; optimistic drafts stay off disk.

Use the data helpers to seed destinations from responses already on screen; seeded posts recheck access immediately. Related edits reconcile against current content, preserve read timestamps and leave missing loads running. Errors roll back without removing other pending edits; server responses patch their items. Invalidate only membership/order that cannot be derived, after the last related edit settles. Reads share an RPC batch within one accepted account generation. Hover and idle prefetching respect Save Data.

Page placeholders wait 300 ms and remain for at least 400 ms. Refreshes keep content visible; forbidden/not-found errors erase it. Post dialogs keep a fixed frame while details, authors and comments load. Searches retain the previous results.

## Appearance and mobile focus

[src/lib/appearance](src/lib/appearance) owns device preference, subscription and the pre-paint bootstrap; Settings owns its control. `index.theme` is System/Light/Dark, independent of sign-out. [theme-plugin.ts](theme-plugin.ts) serves the same-origin blocking bootstrap before CSS/app startup. Desktop synchronizes this store with native chrome and mirrors the last preference natively so a new main window is shown in its final background color; shared UI receives theme as presentation input. Use semantic foreground/surface pairs from [UI styles](../../packages/ui/src/styles/globals.css), including `primary-foreground` rather than hardcoded white. Artwork/generation belongs to [assets/brand](../../assets/brand/README.md).

Preserve these constraints in shared controls, including portals:

- Editable controls need at least 16px text on narrow/coarse-pointer screens to avoid iOS focus zoom. Keep user pinch zoom available.
- Phone sheets initially focus the popup, not an input; desktop dialogs focus their first control. Validation may focus a field. Restore the launch control on close, using a stable ref when there is no trigger. Views stacked in one modal (`ModalViews`, such as a post and its editor) switch the same way: focus moves into the shown view, and a view shown again returns it to the control that opened the view over it. WebKit, and so the desktop app, doesn't focus a link or button it clicks, so that control is recorded as it is used rather than read from focus. Avoid `autoFocus` in shared form contents.
- On macOS the main window's page extends under its transparent titlebar; `--titlebar-inset` is the band the window controls cover there (0 elsewhere). Backdrops and backgrounds extend under it, while content and controls start below it. [titlebar.rs](src-tauri/src/titlebar.rs) keeps dragging and the System Settings double-click action native in that band.
- Sheets follow the actual visual viewport, with safe-area padding and a scrollable body. Do not position their frame using the keyboard inset: its blur reset can move an action between pointerdown and click. Keep list/carousel scrolling intact.

[Mobile browser tests](e2e/mobile-layout.spec.ts) exercise layout and simulated keyboard bounds. Physical Safari still needs keyboard dismissal, rotation and pinch-zoom checks; emulation cannot establish those behaviors.

## Checks

From `apps/web`, with Chromium installed:

```sh
bun run test
VITE_SERVER_URL=http://localhost:3002 bun run check-types
E2E_PRODUCTION=1 bun run test:e2e --headed
```

`bun run check:tooling` from the root separately checks the Bun/Node tools in [scripts/desktop](scripts/desktop), [e2e/server.ts](e2e/server.ts), [e2e/fixtures.ts](e2e/fixtures.ts), and brand generation under strict TypeScript. CI runs this check; Bun execution alone does not check types.

The web type check builds the production frontend. Playwright starts its own disposable PGlite API on 3002 and web preview on 4173. It resets fixture data; do not share that API with simultaneous native tests. Override `E2E_API_PORT` / `E2E_WEB_PORT` for another test stack and build with the matching `VITE_SERVER_URL`. Omit `E2E_PRODUCTION=1` to use Vite development mode; bootstrap cases require a production build.

Install the browser with `bun run playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chromium. On Linux, wrap the headed command with `xvfb-run --auto-servernum`; full Chromium is required for notification-permission cases. Traces/screenshots go to ignored `test-results`.

## Desktop

From the root, `bun desktop:dev` starts the web/API stack and Tauri. Stop `bun dev` first. App Quit or Ctrl-C stops its servers; closing main only hides it. Rust rebuilds restart the host while Vite hot reload continues.

macOS development uses a bundled, ad hoc signed Index Dev identity, separate from installed release apps. UserNotifications requires an application bundle; unbundled executables report it unavailable. Development is host-only; it does not register the Share extension.

For a local host-only build, from `apps/web`:

```sh
VITE_SERVER_URL=http://localhost:3002 bun run desktop:build --local --without-share-extension --bundles app
```

This uses the disposable fixture API and is not a distribution artifact. Normal macOS packaging includes the [Share extension](../../docs/sharing.md#native-packaging-and-checks) and requires signing/profile inputs. [Desktop releases](../../docs/desktop-releases.md) owns channel builds and updates. Native external navigation accepts HTTP(S) only and opens the default browser; remote WebView navigation/popups are blocked. Desktop downloads accept only the page's own `blob:` addresses, save to Downloads under a free name and are revealed in the file manager; on Linux those addresses pass navigation so WebKitGTK can start them.

### Desktop session boundary

[session.rs](src-tauri/src/session.rs) owns API-scoped credentials and revisions. A separate host-only Keychain counter survives restarts and advances before credential writes; a cache cannot become valid again because a process reused zero. Counter read/write failures fail closed. Every window binds requests to its **accepted** revision; it cannot adopt the latest credential to send an old draft. Compare-and-set writes and checks after response parsing prevent stale windows/completions from changing a newer account. Sign-out erases local credentials and clears windows before awaiting best-effort server revocation. Storage erasure failure remains an error. The host caches its token under this revision lock; the read-only Share extension does not change it. A failed secure-store write makes memory snapshots signed out; a later successful write repairs the cache without rereading a credential whose erasure failed.

[Cross-window events](src/lib/desktop/sync.ts) carry only revision/source, never credentials or private content. Focus checks the native revision for missed events, refreshes a stale session and triggers pulse. It does not refetch all content. Peer writes refresh active on-show content and pulse; panel openings retain their own session/content refresh. Per-window account clearing does not own the process-wide notification runtime.

### Menu bar and notifications

[menu_bar.rs](src-tauri/src/menu_bar.rs) owns the main/panel lifecycle. Main close hides it and clears active-conversation presence while notification delivery continues; hiding the panel does not change main's presence. The panel never activates Index, so it opens over full-screen apps without switching Spaces. It is built hidden at launch and revalidates on each opening rather than on focus: while the account revision it last committed content for is current, it shows that content at once and refreshes after showing; after an account change, or before its first commit, it shows only after its session check, so another account's content never appears. Main does not refresh when the panel opens. Like other menu bar extras, a shown panel closes on a click outside it, when another menu opens or when another app becomes active; it watches for these only while shown, and mouse clicks need no Accessibility permission. Quit ends the process and preserves device opt-in. Notification clicks show/create main and require authorized navigation before acknowledgement. Only main mounts the notification lifecycle; [notifications](../../docs/notifications.md) owns delivery rules.

Launch at login reflects `SMAppService` status and changes only on explicit user action. Startup/status reads never register it; OS approval and failures must not appear as enabled. The process lock prevents duplicate apps/pollers. Both windows keep their own native theme synchronization. Ink/Paper Dock preference is device-local and never modifies the signed bundle. So is Show in Dock: when off, Index is an accessory app, out of the Dock and app switcher, and opens from the menu bar or a repeat launch. Settings shows AppKit's activation policy rather than the saved choice. The choice applies once AppKit has started Index, so its Dock icon can appear briefly at launch; a returning icon gets the Ink/Paper choice again.

### Desktop checks

After the web build above, with Rust and platform prerequisites, run from the root:

```sh
cargo test --locked --manifest-path apps/web/src-tauri/Cargo.toml
```

For macOS native integration, start `bun e2e/server.ts` in `apps/web`, then run `bun run desktop:test` there in another terminal. It uses isolated credentials and rebuilds the normal host-only app afterward. This smoke feature omits the Share extension/menu lifecycle and stubs notifications.

Use a real signed bundle to check Keychain restore/erase and two-window account races, menu-bar placement/focus/VoiceOver, the panel's glass (Liquid Glass on macOS 26+, the menu material before) in light and dark mode and with Reduce transparency, main hide/reopen, Quit, Show in Dock off and on (window focus, menu bar and Dock icon), login-item OS approval, sleep/wake and real notifications. Check first-paint/native appearance after relaunch, and titlebar dragging, each double-click action and full screen. Windows/Linux installation and updates need their respective systems; compilation or a mocked browser bridge is not native acceptance.
