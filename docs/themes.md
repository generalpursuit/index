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

## Foundation verification in this VM

The production build, web/shared UI TypeScript checks, and seven device-store tests passed. Five production browser cases verified saved Light/Dark, default System and invalid preference fallback before app JavaScript executes, with `script-src 'self'`. The emitted `dist/index.html` references `/theme.js` before both app modules and CSS. No inline provider script is injected.

The Linux VM's Chromium initially launched but stalled rendering: a separate plain HTML probe (no Index code) received neither animation frames nor media-change events. The live system-switching browser test remains a required check; the store's simulated OS-change test alone is not evidence of live browser switching. Browser suites can use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for an installed Chromium; use the assigned isolated API/web ports. Native tests and source compilation are unrun without Swift/Xcode.
