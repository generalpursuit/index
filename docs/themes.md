# Device appearance

Appearance is `system`, `light`, or `dark`, stored under `index.theme` on this device. System is the default. It is independent of account state, remains after sign-out, and is not sent to the API. Web tabs share the choice for their origin; Tauri and the native app keep their own local preference. Switching domains does not transfer browser storage.

Shared web imports:

```tsx
import { ThemeControl } from "@index/ui/components/theme-control";
import { useTheme } from "@index/ui/hooks/use-theme";
import type { ThemePreference } from "@index/ui/lib/theme";
// useTheme(): { preference, resolved, setPreference }
```

`ThemeControl` is an accessible fieldset of native radios. No provider is required. `installTheme(window)` owns one device store, follows `prefers-color-scheme`, handles unavailable storage, and synchronizes other tabs. Its self-contained `themeBootstrapScript` must run before CSS/app startup; the web build serves it as a same-origin blocking script, compatible with Tauri's existing CSP. The bootstrap sets the root class and `color-scheme` before paint, and React subscribes to that same store.

Use semantic Tailwind colors from `packages/ui/src/styles/globals.css`: `background`, `foreground`, `card`, `popover`, `primary`/`primary-foreground`, `secondary`, `muted`/`muted-foreground`, `surface`, `subtle-foreground`, `accent`, `border`, `input`, `ring`, `destructive`, `destructive-surface`, `success`, `overlay`, `category-*`, and `avatar-foreground`. Foreground pairs follow each surface in both schemes. Use `primary-foreground` on primary buttons/bubbles; do not hardcode white text. Category colors and white avatar initials are intentional semantic roles. Application layout utilities belong in the components; class markers used by tests or scroll hooks are retained.

Native imports: `ThemePreference` from `IndexCore` exposes `storageKey`, `init(storedValue:)`, and `resolved(systemIsDark:)`. `IndexPalette` and `AppearanceSettings` live in `Sources/IndexApp/Theme.swift`. `@AppStorage(ThemePreference.storageKey)` is device-local; `ThemePreference.colorScheme` maps System to `nil` so SwiftUI follows OS appearance, including presented sheets. Use `IndexPalette.background`, `.foreground`, `.surface`, `.card`, `.muted`, `.mutedForeground`, `.border`, `.primary`, `.primaryForeground`, and `.destructive` in new screens.

Native source compilation, Xcode/simulator/device checks, VoiceOver/Dynamic Type, and signed Tauri WKWebView/titlebar behavior must be verified on a Mac. They have not been verified on this Linux VM. Prior native checks in other documents describe earlier builds.

## Verification in this VM

The production build, web/shared UI TypeScript checks, and seven device-store tests passed. Six production bootstrap browser cases passed, including saved Light/Dark, default System, invalid preference fallback, blocked storage and live OS changes before app JavaScript. The emitted `dist/index.html` references `/theme.js` before both app modules and CSS. The first-paint cases enforce `script-src 'self'`; no provider injects an inline script.

The initial Linux renderer stall was resolved by an independent Xvfb display. The working setup is headed Nix Chromium 150 on a fresh owned display `:174` (1440×960×24, `-nolisten tcp`), with the themes API/web ports 3302/4473 and Bun 1.4.2. No `LD_LIBRARY_PATH` or application rendering workaround is required. The rollout runner owns and cleans only its own display and refuses to reuse an existing one:

```sh
# From the worktree root; prepend the verified Bun 1.4.2 bin directory to PATH in this VM.
VITE_SERVER_URL=http://localhost:3302 bun run --cwd apps/web build
E2E_PRODUCTION=1 python3 /home/ono/index/.git/t3-feature-rollout/run-browser-tests.py --feature themes --
```

On another machine, use the repository Playwright workflow with an installed browser:

```sh
bun test apps/web/tests/theme.test.ts apps/web/tests/desktop-session.test.ts
bun run --cwd packages/ui check-types
VITE_SERVER_URL=http://localhost:3302 bun run --cwd apps/web check-types
cd apps/web
E2E_API_PORT=3302 E2E_WEB_PORT=4473 E2E_PRODUCTION=1 bun run test:e2e
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` optionally selects an installed Chromium. Each suite uses disposable, isolated PGlite data. Do not run native fixture checks against the same API while browser tests reset it. Screenshots and traces are in ignored `apps/web/test-results`.

The focused Settings/theme/desktop bridge run passed all 11 cases (37.7s): keyboard-accessible radios, live OS changes, persistence across reload/sign-out/another account, tab synchronization, Light/Dark text contrast (at least 4.5:1), overlays, forms, menus and mobile/desktop layout. Browser bridge assertions verify the commands sent to Tauri, not native execution. Screenshots were inspected at desktop and phone sizes. The full production suite then passed 42/45 (2.3m). Its three failures were corrected: recipient circles now retain the original literal `50%` radius, and the profile scroll assertion accepts the reviewed fractional residual of at most one CSS pixel while retaining sticky-heading/active-week checks. All three affected cases passed on the rebuilt production bundle (10.3s). Final web/shared UI types, 11 theme/desktop transport unit tests and scoped lint passed.

The mobile overflow investigation compared a blank page and the Settings sheet. Under this headed emulation, requesting 390px produced `innerWidth = clientWidth = scrollWidth = 391`, `visualViewport.width = 390.6865539550781` and DPR `0.9999999767169356`. Both documents had zero overflow. The test now asserts exact `scrollWidth === clientWidth` instead of equating rendered geometry to Playwright's requested size; dialog/input and carousel bounds remain checked. No product layout workaround was added.

## Remaining Mac verification

Swift is absent from this VM. Rustup reports no installed toolchains; Cargo reports `rustup could not choose a version of cargo to run, because one wasn't specified explicitly, and no default is configured.` Native compilation/tests, signing, simulator/device checks and actual macOS titlebar behavior are **unrun**. Earlier native results elsewhere in the repository are not evidence for these changes.

On the user's Mac with full Xcode and Rust installed, run from the worktree root (commands below only use disposable loopback endpoints):

```sh
cd apps/ios
swift test
xcodebuild -project Index.xcodeproj -scheme Index \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO \
  INDEX_API_URL=http://localhost:3302 INDEX_WEB_URL=http://localhost:4473 build
cd ../web/src-tauri
cargo fmt --check
cargo test
cd ..
VITE_SERVER_URL=http://localhost:3302 bun run desktop:build --local --bundles app
```

Start `E2E_API_PORT=3302 bun e2e/server.mjs` from `apps/web` in a separate terminal, with no browser suite sharing that fixture. Open `apps/ios/Index.xcodeproj`, set the Debug API/web URL overrides above, and run on small/large iPhone and iPad simulators. A physical device needs a separately configured reachable HTTPS development API. For the desktop, launch the local bundle:

```sh
open -n apps/web/src-tauri/target/release/bundle/macos/Index.app
```

Verify all of these in native builds:

- Cold launch in System under OS Light and Dark; select Light/Dark, terminate and relaunch. Check the first visible content, transparent macOS titlebar/window background, native menus and dialogs for mismatched appearance or flashes. Returning to System must follow later OS changes.
- Sign out and sign into another disposable account: appearance stays on this device while private account data clears. No theme value belongs in the credential store or API.
- Open Settings, nested sheets/dialogs, profile/group menus, post actions, comments and message composers in both schemes. Check focus, hover, selection, errors, disabled states, keyboard avoidance and readable foregrounds on outgoing bubbles and avatar backgrounds.
- Check iPhone/iPad portrait/landscape, large Dynamic Type, VoiceOver labels/selected state, iPad split view, weekly scrolling and sheet dismissal; check macOS resizing, keyboard navigation and native window reopen.

`INDEX_NATIVE_INTEGRATION=1 INDEX_NATIVE_TEST_PORT=3302 swift test` from `apps/ios` exercises the existing native API checks against that isolated API. The existing Tauri `bun run desktop:test` runner uses its own localhost:3002 fixture and requires macOS; run it separately as described in [desktop verification](desktop.md#verification). Neither existing native smoke suite replaces the visual appearance checks above. Signing/notarization, real push and production email delivery are not verified here. Domain names and sender addresses remain configuration inputs; this feature provisions none.
