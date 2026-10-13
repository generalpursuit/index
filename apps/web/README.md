# Web and desktop development

React, TanStack Router/Query and Tauri share one frontend. Run `bun dev` from the root after [local setup](../../docs/deployment.md#local-development); web is on port 3000 and the Alchemy API on 8080. `bun dev:server` selects that same infrastructure task, including its web companion, because the API requires Worker bindings. `bun run --cwd apps/server build` produces the Worker bundle.

## Ownership

- [Routes](src/routes) own URL state, guards and loaders. [Features](src/features) own queries, mutations, drafts and product behavior; loaders and hooks share query options.
- [App components](src/components/app) own navigation, account-model avatars, week controls and query presentation. Forbidden/not-found results hide content; transient refresh failures can retain usable data.
- [Shared UI](../../packages/ui/src) owns accessible primitives, responsive Modal/Confirmation, control styling, tokens and fonts. It has no app routes, API models, account state or native bridge dependencies. Features own layout and product-specific controls.
- Loaders load everything a page shows on its first screen, in parallel, so the current page stays (under a progress bar) until the next is complete. Links pass identifiers they already know in navigation state, so a loader fetches data while `resolveLocation` still checks the path. Data behind a modal is prefetched on hover/focus of what opens it, and the shell takes its layout from the rendered route's `staticData`, never from the pending location.
- Groups own complete-list/selection reconciliation; sharing owns the save destination; links own weekly link presentation; messages own conversation presentation and immutable send attempts. [Retry rules](../../docs/api.md#messages-and-retries) and [account isolation](../../docs/authentication.md#account-isolation) apply across navigation and awaited callbacks.

## Appearance and mobile focus

[src/lib/appearance](src/lib/appearance) owns device preference, subscription and the pre-paint bootstrap; Settings owns its control. `index.theme` is System/Light/Dark, independent of sign-out. [theme-plugin.ts](theme-plugin.ts) serves the same-origin blocking bootstrap before CSS/app startup. Desktop synchronizes this store with native chrome and mirrors the last preference natively so a new main window is shown in its final titlebar/background colors; shared UI receives theme as presentation input. Use semantic foreground/surface pairs from [UI styles](../../packages/ui/src/styles/globals.css), including `primary-foreground` rather than hardcoded white. Artwork/generation belongs to [assets/brand](../../assets/brand/README.md).

Preserve these constraints in shared controls, including portals:

- Editable controls need at least 16px text on narrow/coarse-pointer screens to avoid iOS focus zoom. Keep user pinch zoom available.
- Phone sheets initially focus the popup, not an input; desktop dialogs focus their first control. Validation may focus a field. Restore the launch control on close, using a stable ref when there is no trigger. Avoid `autoFocus` in shared form contents.
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

This uses the disposable fixture API and is not a distribution artifact. Normal macOS packaging includes the [Share extension](../../docs/sharing.md#native-packaging-and-checks) and requires signing/profile inputs. [Desktop releases](../../docs/desktop-releases.md) owns channel builds and updates. Native external navigation accepts HTTP(S) only and opens the default browser; remote WebView navigation/popups are blocked.

### Desktop session boundary

[session.rs](src-tauri/src/session.rs) owns API-scoped credentials and process revisions. Every window binds requests to its **accepted** revision; it cannot adopt the latest credential to send an old draft. Compare-and-set writes and checks after response parsing prevent stale windows/completions from changing a newer account. Sign-out erases local credentials and clears windows before awaiting best-effort server revocation. Storage erasure failure remains an error.

[Cross-window events](src/lib/desktop/sync.ts) carry only revision/source, never credentials or private content. Focus revalidation covers missed events. Per-window account clearing does not own the process-wide notification runtime.

### Menu bar and notifications

[menu_bar.rs](src-tauri/src/menu_bar.rs) owns the main/panel lifecycle. Main close hides it and clears active-conversation presence while notification delivery continues; hiding the panel does not change main's presence. The panel never activates Index, so it opens over full-screen apps without switching Spaces; it checks the session on each opening rather than on focus. Quit ends the process and preserves device opt-in. Notification clicks show/create main and require authorized navigation before acknowledgement. Only main mounts the notification lifecycle; [notifications](../../docs/notifications.md) owns delivery rules.

Launch at login reflects `SMAppService` status and changes only on explicit user action. Startup/status reads never register it; OS approval and failures must not appear as enabled. The process lock prevents duplicate apps/pollers. Both windows keep their own native theme synchronization. Ink/Paper Dock preference is device-local and never modifies the signed bundle.

### Desktop checks

After the web build above, with Rust and platform prerequisites, run from the root:

```sh
cargo test --locked --manifest-path apps/web/src-tauri/Cargo.toml
```

For macOS native integration, start `bun e2e/server.ts` in `apps/web`, then run `bun run desktop:test` there in another terminal. It uses isolated credentials and rebuilds the normal host-only app afterward. This smoke feature omits the Share extension/menu lifecycle and stubs notifications.

Use a real signed bundle to check Keychain restore/erase and two-window account races, menu-bar placement/focus/VoiceOver, main hide/reopen, Quit, login-item OS approval, sleep/wake and real notifications. Check first-paint/native appearance after relaunch. Windows/Linux installation and updates need their respective systems; compilation or a mocked browser bridge is not native acceptance.
