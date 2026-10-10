# Index for iPhone and iPad

Native SwiftUI implementation of the approved mobile design, using the same REST API and permissions as the web client. Requires iOS 17+, Swift 6, and full Xcode for iOS builds. There are no third-party Swift dependencies.

## Run

1. Open `Index.xcodeproj` in Xcode and select the `Index` scheme and an iPhone simulator.
2. Start the disposable development backend from `apps/web` with `bun e2e/server.mjs`. The Debug configuration uses `http://localhost:3002`. Fixture login: `alice@test.example` / `test-password-123`.
3. Run. For an actual development backend, copy `Config/Local.xcconfig.example` to `Config/Local.xcconfig` and supply its HTTPS API/web URLs. An iPhone device cannot use the Mac's localhost; use an HTTPS development endpoint.

Release builds require explicit HTTPS `INDEX_API_URL` and `INDEX_WEB_URL`. Configure your Apple signing team in the ignored local configuration or Xcode. The checked-in bundle identifier is `com.generalpursuit.index`; update it if the distribution account uses another identifier. No production endpoint, signing identity, or secret is embedded in this repository.

```sh
xcodebuild -project Index.xcodeproj -scheme Index \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

The Xcode project is checked in. After adding/removing app source files, reproduce it with `python3 Scripts/generate-project.py`. It links the local `IndexCore` Swift package. `Package.swift` also exposes a macOS `IndexPreview` executable so source compilation can be checked independently of an iOS runtime; that preview is not the Tauri desktop product.

## Structure

- `Sources/IndexCore`: Codable API contracts, UTC week handling, URLSession transport, and Keychain storage.
- `Sources/IndexApp/Features`: feed, profiles/library, link editing/comments, discovery, activity, and conversations.
- `Sources/IndexApp/Components.swift`: shared visual components and asynchronous actions.
- `Sources/IndexUI/Theme.swift`: shared semantic `IndexPalette`; `Sources/IndexApp/Theme.swift` retains the Settings appearance control; `IndexCore.ThemePreference` stores System/Light/Dark under device-local `index.theme`. The app defaults to System and keeps this preference through sign-out.
- `Sources/IndexApp/IndexApp.swift`: authenticated root, navigation, tabs, app session and in-memory conversation drafts.

The five-tab navigation follows mobile web: Index, Discover, Activity, Messages, and your profile. Full pages use `NavigationStack` with explicit back controls; posts, settings, editors, and recipient/connection pickers open in rounded bottom sheets. Readable links use the same presentations, and account changes clear both navigation and sheet state.

The feed keeps its week heading in place, with separate scroll areas for your links and a horizontally snapping carousel of people. The heading opens an accessible week picker; the right-edge scrubber jumps through weeks with content. Link rows match web's colored category markers, single-line titles, and trailing domains. Current-week lists offer inline paste/Return saving through `/links/share`, preserving request identities for retries, duplicate confirmation, the chosen group, and Undo. Profiles use sticky weekly headings, date ranges, and a single group filter instead of cards and segmented sections. Forms and chat composers follow the keyboard safe area.

`IndexUI` bundles the web's Geist, Source Serif 4 (display optical size 60), Geist Mono, and original SVG wordmark. Font registration is shared with the extensions and respects Dynamic Type. The native fonts use the Latin subsets, with Core Text fallback for other scripts. To regenerate after updating the pinned web fonts, install Python `fonttools[woff]`, run `bun install` at the repository root, then run `python3 apps/ios/Scripts/build-fonts.py`. The fonts retain their SIL licenses in `Sources/IndexUI/Resources/Fonts`; regeneration is deterministic. `VisualComponents.swift` supplies shared layout, sheet, search, and week-navigation components.

Messages refresh while the conversation is active, conversations and activity poll while foregrounded. Opted-in APNs delivery and notification preferences are implemented; there is no offline database. See [notification configuration and native launch checks](../../docs/notifications.md). Drafts remain in memory until sent or signed out. Unknown send outcomes retain the original UUID and payload for an idempotent retry. Restricted forwards show only author identity; locked/deleted originals show an unavailable state.

## Loading and cache

The API client retains up to 128 response snapshots in memory for five minutes and shares concurrent GET requests for the same path and query. Views restore these snapshots before refreshing, keeping feed, profiles, post details, conversations, and activity visible during network work. Opening a known post or conversation passes its existing content into the detail screen. Independent requests run concurrently. Polling and pull-to-refresh still reach the API.

Mutations discard snapshots and restart overlapping reads against the new state; read receipts preserve content caches. Sign-out, session expiry, and authentication changes clear snapshots and reject late responses. Forbidden and missing resources evict their snapshots. Recoverable failures can leave already loaded content visible with retry feedback. This cache does not persist across process launches and is not an offline synchronization system.

## Authentication

Only Better Auth's signed `set-auth-token` header is retained. Native requests do not use cookies, and tokens are never stored in UserDefaults. Keychain entries are scoped to the API URL and use `WhenUnlockedThisDeviceOnly`. Session expiry/sign-out erase credentials and account state. The transport rejects remote HTTP and redirects; it accepts HTTP only for loopback development. The backend remains responsible for all content permissions.

Restricted sessions show email verification instead of application content, including old unverified accounts. Passwords remain required for login; recovery codes never log in. See [email security](../../docs/authentication.md) for API contracts, delivery configuration, pending-link behavior and the Mac verification checklist. The new security source/tests have not been compiled or run on this Linux VM.

## Checks

```sh
swift test
# With the disposable API running on localhost:3002:
INDEX_NATIVE_INTEGRATION=1 swift test
# For a separately running disposable test API, also set INDEX_NATIVE_TEST_PORT=3202.
```

The integration test resets **only the disposable fixture API** and checks real signed login/restoration, weekly pagination, Favorites, comments, private forwarding, send retries, replies, follow requests, group locking, and logout. It does not use production credentials or databases. Do not run it concurrently with browser tests that use that fixture server.

The mobile web parity changes passed Swift syntax parsing and the four Linux-capable packaging/security checks in `Scripts/check-sharing-source.py`. Bundled fonts were checked for valid PostScript names, static weights, licenses, and deterministic regeneration. Read-only checks against the disposable API confirmed the feed-week, pagination, group, and discovery contracts. These are not an iOS build or a native visual test: this Linux environment lacks Apple SDKs, and T3 device access is disabled. Run the Xcode build above and compare the iPhone feed, profile, post/editor sheets, settings, discovery, activity, and messaging screens against mobile web at the same viewport and with the same account. Also follow the [appearance Mac checklist](../../docs/themes.md#remaining-mac-verification), including live OS changes and relaunch. The following results describe an earlier build.

On the earlier Mac's command-line-only installation, source compilation succeeded against the installed macOS 26.5 SDK. Tests require explicitly loading the installed Testing plugin/runtime; `Scripts/check-local.sh` captures that workaround. The latest run passed twelve unit tests (including a real Keychain round trip and authentication error cases) and the real-API integration test. These checks do not establish iPhone layout or simulator behavior. Full Xcode is still required for simulator/device verification, signing, and an iOS archive.

Before distribution, verify at small and large iPhone sizes and iPad, with the software keyboard, landscape orientation, VoiceOver, and large Dynamic Type. Exercise Keychain restore after force quit, native back gestures, privacy changes, and private forwards between separate accounts.

## Readable links

Profiles, collections, post sharing and inbound links use the shared [readable route contract](../../docs/readable-routes.md). Set `INDEX_WEB_URL` to the canonical web origin and optional comma-separated `INDEX_WEB_ALIASES` for aliases. Universal links also require the final associated-domain/AASA/signing setup. New native route parser/readiness tests and AppModel navigation changes have not been compiled or run on this Linux VM; run the documented Swift/Xcode checks on a Mac before distribution.

## Group management

Settings manages personal link collections using the same compact lock control as the group editor. New groups default unlocked; Starred is always private. Profile creation selects the returned group automatically. See the [group callback contract and Mac verification checklist](../../docs/groups.md). The new native group source/tests are unverified on this Linux VM; earlier Mac checks above do not cover them.

## Share extension

`IndexShare` is a real embedded iPhone/iPad Share extension; `IndexShareMac` supplies the Tauri macOS bundle. Shared picker/group creation lives in `IndexSharing`/`IndexUI`. Both require explicit shared Keychain signing and a one-time sign-in when upgrading from legacy storage. See [sharing implementation, configuration and exact Mac checks](../../docs/sharing.md). The new Swift, Objective-C and Rust source has not been compiled or launched on this Linux VM.
