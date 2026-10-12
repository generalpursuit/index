# Index for iPhone and iPad

Native SwiftUI implementation of the approved mobile design, using the same REST API and permissions as the web client. Requires iOS 17+, Swift 6, and full Xcode for iOS builds. There are no third-party Swift dependencies.

## Branding and app icon

The login wordmark, Home tab symbol, and app icon use the supplied Index artwork.
Settings → App icon offers Ink (default) and Paper. iOS owns and persists the Home
Screen icon choice, independently of the appearance preference and signed-in account.
A failed change keeps the existing icon and shows an error.

Original assets and the regeneration command live in [assets/brand](../../assets/brand/README.md).
Both icon sets are included for iPhone and iPad through the asset catalog compiler;
keep `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES` in the generated project.
The shared SwiftUI artwork is bundled with `IndexUI`, including the macOS preview.
The preview does not offer an iOS-only Home Screen icon setting.

## Run

1. Open `Index.xcodeproj` in Xcode and select the `Index` scheme and an iPhone simulator.
2. Start the disposable development backend from `apps/web` with `bun e2e/server.ts`. The Debug configuration uses `http://localhost:3002`. Fixture login: `alice@test.example` / `test-password-123`.
3. Run. For an actual development backend, copy `Config/Local.xcconfig.example` to `Config/Local.xcconfig` and supply its HTTPS API/web URLs. An iPhone device cannot use the Mac's localhost; use an HTTPS development endpoint.

Release builds require explicit HTTPS `INDEX_API_URL` and `INDEX_WEB_URL`. Configure your Apple signing team in the ignored `Config/Local.xcconfig`; changing generated project settings in Xcode will be overwritten by regeneration. The checked-in bundle identifier is `com.generalpursuit.index`; update it if the distribution account uses another identifier. No production endpoint, signing identity, or secret is embedded in this repository.

```sh
xcodebuild -project Index.xcodeproj -scheme Index \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

The Xcode project is checked in. After adding/removing app source files, reproduce it with `python3 Scripts/generate-project.py`. It links the local `IndexCore`, `IndexFeatures`, and `IndexUI` products. The generator is the source of truth for project settings and shared schemes. `python3 Scripts/check-sharing-source.py` checks reproducibility in a temporary directory without rewriting the checkout. `Package.swift` also exposes a macOS `IndexPreview` executable so source compilation can be checked independently of an iOS runtime; that preview is not the Tauri desktop product.

## Structure

- `Sources/IndexCore`: Codable API contracts, UTC week handling, URLSession transport, and Keychain storage.
- `Sources/IndexFeatures`: testable message drafts, messaging/activity/profile/feed loading, account lifetime, and navigation state. Feature models use the existing API transport through a small injectable contract. An internal cursor collection owns loaded-page extent, request generations and duplicate removal.
- `Sources/IndexApp/Features`: SwiftUI feature layouts and presentation state; complex messaging/activity/profile/feed loading lives in `IndexFeatures`.
- `Sources/IndexApp/Components.swift`: shared visual components and asynchronous actions.
- `Sources/IndexUI/Theme.swift`: shared semantic `IndexPalette`; `Sources/IndexApp/Theme.swift` retains the Settings appearance control; `IndexCore.ThemePreference` stores System/Light/Dark under device-local `index.theme`. The app defaults to System and keeps this preference through sign-out.
- `Sources/IndexApp/IndexApp.swift`: authenticated SwiftUI root and destination rendering.
- `Sources/IndexApp/AppModel.swift`: session/notification coordination and shared content-change signals. Private view identity, drafts, unread counts and presentation state reset together on account transitions.

The five-tab navigation follows mobile web: Index, Discover, Activity, Messages, and your profile. Full pages use `NavigationStack` with explicit back controls; posts, settings, editors, and recipient/connection pickers open in rounded bottom sheets. Readable links use the same presentations, and account changes clear both navigation and sheet state.

The feed keeps its week heading in place, with separate scroll areas for your links and a horizontally snapping carousel of people. The heading opens an accessible week picker; the right-edge scrubber jumps through weeks with content. Link rows match web's colored category markers, single-line titles, and trailing domains. Current-week lists offer inline paste/Return saving through `/links/share`, preserving request identities for retries, duplicate confirmation, the chosen group, and Undo. Profiles use sticky weekly headings, date ranges, and a single group filter instead of cards and segmented sections. Forms and chat composers follow the keyboard safe area.

`IndexUI` bundles the web's Geist, Source Serif 4 (display optical size 60), Geist Mono, and original SVG wordmark. Font registration is shared with the extensions and respects Dynamic Type. The native fonts use the Latin subsets, with Core Text fallback for other scripts. To regenerate after updating the pinned web fonts, install Python `fonttools[woff]`, run `bun install` at the repository root, then run `python3 apps/ios/Scripts/build-fonts.py`. The fonts retain their SIL licenses in `Sources/IndexUI/Resources/Fonts`; regeneration is deterministic. `VisualComponents.swift` supplies shared layout, sheet, search, and week-navigation components.

Messages refresh while the conversation is active, conversations and activity poll while foregrounded. Opted-in APNs delivery and notification preferences are implemented; there is no offline database. See [notification configuration and native launch checks](../../docs/notifications.md). Drafts remain in memory until sent or signed out. Unknown send outcomes retain the original UUID and payload for an idempotent retry. Restricted forwards show only author identity; locked/deleted originals show an unavailable state.

## Loading and cache

The API client retains up to 128 response snapshots in memory for five minutes and shares concurrent GET requests for the same path and query. Feature models and detail views restore these snapshots before refreshing, keeping feed, profiles, post details, conversations, and activity visible during network work. Conversation and activity polling replays the loaded page count and publishes the refreshed extent atomically. Query changes invalidate previous completions; overlapping pagination cannot append the same page twice. Opening a known post or conversation passes its existing content into the detail screen. Independent requests run concurrently. Polling and pull-to-refresh still reach the API.

Mutations discard snapshots and restart overlapping reads against the new state; read receipts preserve content caches. Sign-out, session expiry, and authentication changes clear snapshots and reject late responses. Forbidden and missing resources evict their snapshots and clear displayed feature content; restricted sessions also remove private UI state. Recoverable failures can leave already loaded content visible with retry feedback. This cache does not persist across process launches and is not an offline synchronization system.

## Authentication

Only Better Auth's signed `set-auth-token` header is retained. Native requests do not use cookies, and tokens are never stored in UserDefaults. Keychain entries are scoped to the API URL and use `WhenUnlockedThisDeviceOnly`. Session expiry/sign-out erase credentials and account state. The transport rejects remote HTTP and redirects; it accepts HTTP only for loopback development. The backend remains responsible for all content permissions.

Restricted sessions show email verification instead of application content, including old unverified accounts. Passwords remain required for login; recovery codes never log in. See [email security](../../docs/authentication.md) for API contracts, delivery configuration, pending-link behavior and the Mac verification checklist.

## Checks

`Scripts/check-sharing-source.py` provides Linux-capable project and packaging
checks. `IndexFeaturesTests` covers uncertain send identity, validation recovery,
account changes during sends, paginated refresh, stale completions, access
revocation, and pending-route/account transitions. These behavioral tests are part
of the Swift package suite below.

Syntax parsing and packaging checks do not establish Swift 6 type correctness or
iOS behavior. The cleanup was developed in a Linux environment without Xcode;
run the native checks on a Mac before merging it.

From the repository root, run the same native checks as CI:

```sh
bun run check:ios
# Without Bun:
sh apps/ios/Scripts/check-local.sh
```

This requires full Xcode selected under Xcode > Settings > Locations > Command Line Tools,
an installed iOS Simulator runtime, and an available iPhone simulator. It compiles
the Debug app and embedded Share extension for both a generic iOS device and a
concrete iPhone simulator with signing disabled, then runs the Swift package tests
on macOS (also compiling `IndexPreview`). No Apple account, connected device,
booted simulator, or backend is needed. The script fails if either build or the
tests fail; it does not silently skip the simulator or use standalone Command Line Tools.

Debug builds use `ONLY_ACTIVE_ARCH = YES`, matching Swift Package Manager's
selected-destination behavior. Without it, the app/extension can request both
arm64 and x86_64 simulator modules while their packages only provide the current
Mac's architecture. Release builds keep `ONLY_ACTIVE_ARCH = NO`. CI selects an
actual available simulator and does not override this setting, so it catches that
mismatch. The release endpoint validation script intentionally runs every build.

The **iOS build and tests** job in `.github/workflows/ci.yml` runs this script on `macos-26` for every pull request and in the reusable checks required before deployment. Add this check to GitHub branch protection alongside the existing web/backend checks to require it before merging. Device launch, signing, layout, real push delivery, and the opt-in API integration tests remain separate checks.

For focused Swift package checks, run from `apps/ios`:

```sh
swift test
# With the disposable API running on localhost:3002:
INDEX_NATIVE_INTEGRATION=1 swift test
# For a separately running disposable test API, also set INDEX_NATIVE_TEST_PORT=3202.
```

The integration test resets **only the disposable fixture API** and checks real signed login/restoration, weekly pagination, Favorites, comments, private forwarding, send retries, replies, follow requests, group locking, and logout. It does not use production credentials or databases. Do not run it concurrently with browser tests that use that fixture server.

Before distribution, verify at small and large iPhone sizes and iPad, with the software keyboard, landscape orientation, VoiceOver, and large Dynamic Type. Exercise Keychain restore after force quit, native back gestures, privacy changes, and private forwards between separate accounts.

## Readable links

Profiles, collections, post sharing and inbound links use the shared [readable route contract](../../docs/readable-routes.md). Set `INDEX_WEB_URL` to the canonical web origin and optional comma-separated `INDEX_WEB_ALIASES` for aliases. Universal links also require the final associated-domain/AASA/signing setup. Run the route, account-lifetime and navigation tests with the documented Swift/Xcode checks on a Mac before distribution.

## Group management

Settings manages personal link collections using the same compact lock control as the group editor. New groups default unlocked; Starred is always private. Profile creation selects the returned group automatically. See the [group visibility rules](../../docs/api.md#visibility-and-groups).

## Share extension

`IndexShare` is a real embedded iPhone/iPad Share extension; `IndexShareMac` supplies the Tauri macOS bundle. Shared picker/group creation lives in `IndexSharing`/`IndexUI`. Both require explicit shared Keychain signing and a one-time sign-in when upgrading from legacy storage. See [sharing implementation, configuration and exact Mac checks](../../docs/sharing.md).
