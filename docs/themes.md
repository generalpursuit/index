# Device appearance

Appearance is `system`, `light`, or `dark`, stored under `index.theme` on this device. System is the default. It is independent of account state, remains after sign-out, and is not sent to the API. Web tabs share the choice for their origin; Tauri and the native app keep their own local preference. Switching domains does not transfer browser storage.

Web appearance is application/device state:

```tsx
import { ThemeControl } from "@/features/settings/appearance";
import { useTheme } from "@/lib/appearance/use-theme";
import type { ThemePreference } from "@/lib/appearance/store";
// useTheme(): { preference, resolved, setPreference }
```

`ThemeControl` is an accessible fieldset of native radios in Settings. No provider is required. `installTheme(window)` owns one device store under `__INDEX_THEME__`, follows `prefers-color-scheme`, handles unavailable storage, and synchronizes other tabs. Its self-contained `themeBootstrapScript` runs before CSS/app startup through `apps/web/theme-plugin.ts`; the build serves `/theme.js` as a same-origin blocking script, compatible with Tauri's CSP. The bootstrap sets the root class and `color-scheme` before paint, and React subscribes to that same store. Desktop appearance synchronization uses this web store; the shared UI toaster receives the resolved theme from the root component.

The UI package owns visual tokens, fonts and presentation, without storage keys, bootstrap or app account/platform dependencies. Its stylesheet scans UI sources; the importing web stylesheet registers web source files.

Use semantic Tailwind colors from `packages/ui/src/styles/globals.css`: `background`, `foreground`, `card`, `popover`, `primary`/`primary-foreground`, `secondary`, `muted`/`muted-foreground`, `surface`, `subtle-foreground`, `accent`, `border`, `input`, `ring`, `destructive`, `destructive-surface`, `success`, `overlay`, `category-*`, and `avatar-foreground`. Foreground pairs follow each surface in both schemes. Use `primary-foreground` on primary buttons/bubbles; do not hardcode white text. Category colors and white avatar initials are intentional semantic roles. Application layout utilities belong in the components; class markers used by tests or scroll hooks are retained.

Native imports: `ThemePreference` from `IndexCore` exposes `storageKey`, `init(storedValue:)`, and `resolved(systemIsDark:)`. `IndexPalette` and `AppearanceSettings` live in `Sources/IndexApp/Theme.swift`. `@AppStorage(ThemePreference.storageKey)` is device-local; `ThemePreference.colorScheme` maps System to `nil` so SwiftUI follows OS appearance, including presented sheets. Use `IndexPalette.background`, `.foreground`, `.surface`, `.card`, `.muted`, `.mutedForeground`, `.border`, `.primary`, `.primaryForeground`, and `.destructive` in new screens.

## Checks

```sh
bun run --cwd apps/web test
bun run --cwd packages/ui check-types
VITE_SERVER_URL=http://localhost:3302 bun run --cwd apps/web check-types
cd apps/web
E2E_API_PORT=3302 E2E_WEB_PORT=4473 E2E_PRODUCTION=1 bun run test:e2e themes.spec.ts theme-bootstrap.spec.ts groups.spec.ts mobile-layout.spec.ts
```

The browser suite uses disposable PGlite data and checks the production bootstrap before application modules, including saved/default/invalid preferences, unavailable storage, live system changes, cross-tab changes and signed-out persistence. It also checks light/dark settings, nested dialogs, focus and narrow-screen layout. Artifacts go to ignored `apps/web/test-results`.

On Linux, run Playwright with `--headed` under an owned Xvfb display (`xvfb-run --auto-servernum`). Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an already installed Chromium. The API/web ports must match the build and remain isolated from other test suites. Chromium phone emulation and simulated viewport changes do not verify physical Safari keyboard behavior or native Tauri chrome.

## Remaining Mac verification

Native compilation, signing, simulator/device checks and actual macOS titlebar behavior require a Mac with Xcode and Rust. Linux browser checks do not establish those results.

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
