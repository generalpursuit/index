# Desktop application

The existing Tauri wrapper hosts the same production React application. Native commands read/write one API-scoped session credential, open HTTP(S) websites, and apply the device appearance to native window chrome. Remote navigations and new WebView windows are blocked; websites open in the default browser. The desktop uses the documented global Tauri bridge, so no additional JavaScript bridge dependency is needed.

## Menu bar

The macOS host now provides a compact menu-bar window with this week's own links, the shared quick-add/destination picker, Open Index, Quit and optional OS-managed Launch at login. Closing main hides it while the native notification runtime continues. Both windows share revision-guarded secure sessions and content-free cache invalidation. See [menu-bar behavior, commands, VM tests and required Mac checks](menu-bar.md).

## Branding and app icon

The supplied Index Ink artwork is the bundled launcher icon. Settings → App icon
offers Ink and Paper on macOS. The native `app_icon` module applies the selection
through AppKit and saves it in device-local preferences only after a successful
change. It restores the choice before the main window opens. Signing out and
changing appearance do not reset it. Finder and the downloaded app keep the bundled
Ink icon; the signed bundle is never modified. Browsers and other desktop platforms
do not offer the macOS Dock preference.

Source artwork and regeneration: [assets/brand](../assets/brand/README.md).
`app_icon_status` reports support and the saved icon; `set_app_icon` accepts only
`ink` or `paper` and returns the applied selection. The frontend waits for that
result and retains its previous selection on error.

The focused native check is `bun run desktop:test --icons-only` from `apps/web`,
with the disposable fixture API running as described below. It verifies the actual
AppKit image, rejects invalid choices, and checks restoration in a second process.
It uses a separate test preference key and rebuilds the normal host-only app after
completion. Browser tests in `e2e/app-icon.spec.ts` cover saved selection, failure
feedback and unsupported platforms.

## Integration status

The branding update was verified on macOS with a packaged build: Ink/Paper reached
AppKit, invalid choices were rejected, and Paper was restored after a process
restart. Rust tests, web build/types and three focused browser tests also passed.
This verifies native compilation and icon behavior; menu-bar/login-item behavior
and the broader [appearance Mac checklist](themes.md#remaining-mac-verification)
remain separate checks. The session verification below describes an earlier Mac build.

The macOS app compiles and packages with `keyring` 4.2 (OS credential store) and `tauri-plugin-opener` 2; resolved dependencies are recorded in Cargo.lock. Native verification passed in the packaged WKWebView: UI login against the real fixture backend, Keychain persistence across separate app processes, logout and a signed-out restart, external-browser dispatch, rejection of non-web URLs, resizing between 390×844 and 1200×860, and animated week scrolling that snaps and loads the correct week’s data. The web build/types, transport tests, and Playwright desktop-bridge test also passed.

The local app is `apps/web/src-tauri/target/release/bundle/macos/Index.app`. It connects to the disposable API on localhost:3002. This is an ad hoc signed development artifact; distribution still needs production URLs, signing/notarization, and release QA. Windows/Linux packaging has not been verified on this Mac.

## Development

Run either development workflow from the repository root:

```sh
bun dev          # Web and API
bun desktop:dev  # Web, API, and desktop app
```

Stop `bun dev` before switching to `bun desktop:dev`. The desktop command starts
the same Alchemy development stack through Tauri's `beforeDevCommand` hook and
waits for the frontend at `http://localhost:3000`. Alchemy supplies the local API
URL to Vite; the native shell defaults to the same `http://localhost:8080` API.
Use the same local environment and Alchemy account setup as `bun dev`; no extra
terminal or manual `VITE_SERVER_URL` is needed. The command also works from
`apps/web`.

App Quit or Ctrl-C stops the servers started by the desktop command. Closing the
main window only hides it, so the development session continues. Rust rebuilds
restart the native app while keeping the servers running.

On macOS this launches an ad hoc signed development bundle at
`apps/web/src-tauri/target/debug/bundle/dev/Index Dev.app`. It uses
`com.generalpursuit.index.dev`, so its notification permission, device preferences,
and single-instance lock are separate from the installed Index app. Session
credentials retain their existing API URL scope.

`tauri.dev.conf.json` configures a macOS Cargo executable runner. After each build,
the runner copies the executable and icon into the bundle, writes its identity
metadata, signs it, and replaces its own process with the bundled executable.
Tauri still owns Rust watching, rebuilds, and process shutdown. Vite still serves
the frontend with hot reload; no production frontend build is needed. Other
desktop platforms keep Cargo's normal launch behavior.

Additional Tauri options can follow `bun run desktop:dev` from either directory,
including `--no-watch` or `--config` overrides. To attach to servers you have
already started, use
`bun desktop:dev --config '{"build":{"beforeDevCommand":""}}'`. The runner uses the executable path supplied by Cargo,
including custom target directories and profiles. This development bundle is
host-only; testing the Share extension still requires the packaging workflow below.

Direct `tauri dev` or `cargo run` on macOS starts an unbundled executable. Native
notifications report unavailable there: UserNotifications requires a real app
bundle and throws an exception when initialized from a bare executable.

The backend already permits `tauri://localhost` and `http://tauri.localhost` origins and exposes Better Auth's `set-auth-token` header. Desktop uses that signed header as a bearer token; it does not depend on cross-site WebView cookies. The credential store is scoped by API URL. Token reads/writes run off the UI thread. Logout clears the local credential even if the network request fails. No token is written to browser storage or logged.

## Packaging

```sh
cd apps/web
VITE_SERVER_URL=https://api.example.com \
  bun run desktop:build
```

Replace the example origin with the deployed API origin. The wrapper script validates it and restricts the packaged CSP's network access to the configured API plus Tauri IPC. For a local integration build against the disposable API:

```sh
VITE_SERVER_URL=http://localhost:3002 \
  bun run desktop:build --local --bundles app
```

That local build is a test artifact and is not suitable for distribution. Use the normal Tauri signing/notarization environment for release builds. Signing identities and production endpoint selection remain deployment inputs.

## Verification

```sh
bun test apps/web/tests/desktop-session.test.ts
bun test apps/web/tests/desktop-dev.test.ts
cd apps/web && bun run test:e2e
cd src-tauri && cargo test
```

The desktop development tests run on macOS with Xcode command-line tools and the
repository's Bun version. They compile the real Objective-C notification bridge
and exercise bundled startup, permission-status reads, unbundled fallback,
argument/environment/exit-code forwarding, signing, and process termination. They
do not request permission or send notifications. These checks do not use the
`native-smoke` stubs.

For development-loop verification, run `desktop:dev`, edit a frontend component
and confirm hot reload, then edit Rust and confirm the old app exits before the
new one starts. Check both app Quit and Ctrl-C for cleanup. A macOS WKWebView
fixture verified these paths together with native notification status on
2026-10-11; notification opt-in and actual delivery remain separate checks.

For the repeatable macOS native integration check, start `bun e2e/server.mjs` in `apps/web`, then run `bun run desktop:test` there. The runner builds with the opt-in `native-smoke` feature, launches separate native processes for session and icon restoration, checks their results, and rebuilds the normal app without test hooks. Test credentials use a separate Keychain service and are removed on completion. The fixture server must not be reset by another test suite during this check.

`cargo test system_credential_round_trip -- --ignored --nocapture` additionally exercises the Rust credential store with a dummy entry. It requires an unlocked OS credential store, so it is excluded from ordinary unit runs.

Unsigned development binaries can trigger a Keychain access prompt after a rebuild because their code signature changes. The smoke runner clears only its own isolated test credential before rebuilding; it never deletes normal app sessions. Distribution must use a stable signing identity. Keyboard/accessibility review and Windows/Linux builds still need their respective environments.

## Native Share extension

Normal macOS packaging now builds and embeds the real IndexShareMac extension and requires the configured shared Keychain group, signing identity and provisioning profiles. See [sharing packaging and Mac checks](sharing.md#tauri-macos-packaging). Existing host-only smoke checks use their separate credential namespace and do not verify sharing.
Notification preferences, native background delivery, menu-bar lifecycle contract and unverified Mac/service launch checks: [notifications](notifications.md).
