# Desktop application

The existing Tauri wrapper hosts the same production React application. Native commands read/write one API-scoped session credential, open HTTP(S) websites, and apply the device appearance to native window chrome. Remote navigations and new WebView windows are blocked; websites open in the default browser. The desktop uses the documented global Tauri bridge, so no additional JavaScript bridge dependency is needed.

## Integration status

The verification below describes an earlier Mac build. The current appearance changes have browser/bridge coverage on Linux, but Rust compilation, packaged WKWebView and macOS titlebar behavior remain unverified. Follow the [appearance Mac checklist](themes.md#remaining-mac-verification).

The macOS app compiles and packages with `keyring` 4.2 (OS credential store) and `tauri-plugin-opener` 2; resolved dependencies are recorded in Cargo.lock. Native verification passed in the packaged WKWebView: UI login against the real fixture backend, Keychain persistence across separate app processes, logout and a signed-out restart, external-browser dispatch, rejection of non-web URLs, resizing between 390×844 and 1200×860, and animated week scrolling that snaps and loads the correct week’s data. The web build/types, transport tests, and Playwright desktop-bridge test also passed.

The local app is `apps/web/src-tauri/target/release/bundle/macos/Index.app`. It connects to the disposable API on localhost:3002. This is an ad hoc signed development artifact; distribution still needs production URLs, signing/notarization, and release QA. Windows/Linux packaging has not been verified on this Mac.

## Development

Start the normal web/API stack first. The native shell's development URL is `http://localhost:3000`. Supply the same API URL to Vite and Cargo so secure-storage scoping matches the running application:

```sh
cd apps/web
VITE_SERVER_URL=http://localhost:8080 bun run desktop:dev
```

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
cd apps/web && bun run test:e2e
cd src-tauri && cargo test
```

For the repeatable macOS native integration check, start `bun e2e/server.mjs` in `apps/web`, then run `bun run desktop:test` there. The runner builds with the opt-in `native-smoke` feature, launches three separate native processes, checks their results, and rebuilds the normal app without test hooks. Test credentials use a separate Keychain service and are removed on completion. The fixture server must not be reset by another test suite during this check.

`cargo test system_credential_round_trip -- --ignored --nocapture` additionally exercises the Rust credential store with a dummy entry. It requires an unlocked OS credential store, so it is excluded from ordinary unit runs.

Unsigned development binaries can trigger a Keychain access prompt after a rebuild because their code signature changes. The smoke runner clears only its own isolated test credential before rebuilding; it never deletes normal app sessions. Distribution must use a stable signing identity. Keyboard/accessibility review and Windows/Linux builds still need their respective environments.

## Native Share extension

Normal macOS packaging now builds and embeds the real IndexShareMac extension and requires the configured shared Keychain group, signing identity and provisioning profiles. See [sharing packaging and Mac checks](sharing.md#tauri-macos-packaging). Existing host-only smoke checks use their separate credential namespace and do not verify sharing.
Notification preferences, native background delivery, menu-bar lifecycle contract and unverified Mac/service launch checks: [notifications](notifications.md).
