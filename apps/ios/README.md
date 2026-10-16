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

The Xcode project is checked in. After adding/removing app source files or changing the root `package.json` version, reproduce it with `python3 Scripts/generate-project.py`; the app and its extensions take their marketing version from that file. It links the local `IndexCore`, `IndexFeatures`, and `IndexUI` products. The generator is the source of truth for project settings and shared schemes. `python3 Scripts/check-sharing-source.py` checks reproducibility in a temporary directory without rewriting the checkout. `Package.swift` also exposes a macOS `IndexPreview` executable so source compilation can be checked independently of an iOS runtime; that preview is not the Tauri desktop product.

## Structure

- `Sources/IndexCore`: Codable API contracts, UTC week handling, URLSession transport, and Keychain storage.
- `Sources/IndexFeatures`: testable message drafts, messaging/activity/profile/feed loading, account lifetime, and navigation state. Feature models use the existing API transport through a small injectable contract. An internal cursor collection owns loaded-page extent, request generations and duplicate removal.
- `Sources/IndexApp/Features`: SwiftUI feature layouts and presentation state; complex messaging/activity/profile/feed loading lives in `IndexFeatures`.
- `Sources/IndexApp/Components.swift`: shared visual components and asynchronous actions.
- `Sources/IndexUI/Theme.swift`: shared semantic `IndexPalette`; `Sources/IndexApp/Theme.swift` retains the Settings appearance control; `IndexCore.ThemePreference` stores System/Light/Dark under device-local `index.theme`. The app defaults to System and keeps this preference through sign-out.
- `Sources/IndexApp/IndexApp.swift`: authenticated SwiftUI root and destination rendering.
- `Sources/IndexApp/AppModel.swift`: session/notification coordination and the verified account store. Private view identity, drafts, unread counts and presentation state reset together on account transitions.

The five-tab navigation follows mobile web: Index, Discover, Activity, Messages, and your profile. Full pages use `NavigationStack` with explicit back controls; posts, settings, editors, and recipient/connection pickers open in rounded bottom sheets. Readable links use the same presentations, and account changes clear both navigation and sheet state.

Mobile web is the source of truth for native feature layout, wording, and controls. Compare affected screens at phone sizes when changing either client; platform gestures and accessibility remain native.

The feed keeps its week heading in place, with separate scroll areas for your links and a horizontally snapping carousel of people. The heading opens an accessible week picker; the centered right-edge scrubber jumps through weeks with content. Link rows match web's colored category markers, single-line titles, and trailing domains. Current-week lists offer inline paste/Return saving through `/links/share`, preserving request identities for retries, duplicate confirmation, the chosen group, and Undo. Quick-add dismisses the keyboard by tapping outside the field or dragging it down from the profile/feed's vertical scroll areas. Dismissal retains the draft without saving; field taps and text selection keep focus, other controls still receive outside taps, and leaving the screen clears input focus. Profiles use sticky weekly headings, date ranges, and a floating, horizontally scrolling list dock matching mobile web. Profile names shrink to fit one line. Native sheets show a drag handle and support the accessibility escape action for dismissal. Forms and chat composers follow the keyboard safe area.

`IndexUI` bundles the web's Geist, Source Serif 4 (display optical size 60), Geist Mono, and original SVG wordmark. Font registration is shared with the extensions and respects Dynamic Type. The native fonts use the Latin subsets, with Core Text fallback for other scripts. To regenerate after updating the pinned web fonts, install Python `fonttools[woff]`, run `bun install` at the repository root, then run `python3 apps/ios/Scripts/build-fonts.py`. The fonts retain their SIL licenses in `Sources/IndexUI/Resources/Fonts`; regeneration is deterministic. `VisualComponents.swift` supplies shared layout, sheet, search, and week-navigation components.

A foreground pulse keeps conversations, messages and activity fresh. Opted-in APNs delivery and notification preferences are implemented; Foundation response files retain authorized content across launches. See [notification configuration and native launch checks](../../docs/notifications.md). Drafts remain in memory until sent or signed out. Unknown send outcomes retain the original UUID and payload for an idempotent retry. Restricted forwards show only author identity; locked/deleted originals show an unavailable state.

## Loading and cache

`IndexCore.ResponseCache` owns shared in-flight GETs and synchronous memory/disk snapshots. The disk tier lives in Application Support, is excluded from backup, and uses `completeUntilFirstUserAuthentication` protection on iOS. Binary property-list envelopes identify their format, normalized API scope and verified account. Both tiers are bounded to 128 responses and seven days; expired, malformed or mismatched entries are discarded. Filenames carry response keys, and pruning reads file dates rather than decoding content. Search results, device notification state and pulse responses stay in memory; credentials remain in Keychain and drafts remain account-local in memory.

A verified session remembers its account ID beside the cache. With both that identity and a Keychain token, launch builds the account store synchronously from disk and renders cached screens before checking the session in the background. The provisional store is read-only: content requests, edits, warm-up and response writes wait for verification. The same verified account keeps its store, navigation and drafts. Offline or transient verification failures preserve cached content with retry feedback; foregrounding retries the check. A mismatched account, expired or missing session clears content and requires sign-in; a restricted account clears content and shows verification. Without a remembered identity, launch waits for the session check. Share extensions never read or change the remembered identity.

`IndexFeatures.AccountStore` owns feed weeks, profiles and their filtered weeks, post details, discovery, conversations, recipient/connection lists, activity and notification preferences. Screens select these resources synchronously and reuse them across navigation; visited tab roots retain presentation state through pushes. Resource retention is bounded by recent use; the open conversation and active reads/edits survive eviction. Search lists retain the empty query and the latest query. Rows pass their existing person, post or conversation into the destination. A profile summary always loads its full resources, even when its identity snapshot is fresh; Discover warm-up never replaces a search. Cold placeholders use the actual views with redacted content, delayed 300 ms and held at least 400 ms. Refreshes preserve content and geometry, including on recoverable errors. Cursor refreshes replay the loaded extent atomically; superseded pagination cannot append stale pages or leave a spinner running.

The store refreshes on show after 30 seconds, or five minutes for settings profile/notification preferences. Group menus use the content schedule. Explicit refresh and retry bypass age. A single foreground driver requests `/me/pulse` about every 15 seconds, or four seconds with a conversation open and focused, and on foreground and notification delivery. Sheet and conversation changes update cadence without restarting the driver. Push focus is posted only when the active conversation or foreground state changes. Changed versions refresh the main inboxes, any visible filter/search, and the open conversation; dormant filters catch up on show. A failed list retries independently. A 404 switches that account store to the older unread endpoints. Backgrounding stops the driver. A sustained press preloads post details. After the first screen settles, idle warm-up prepares the main screens unless Low Data Mode, Low Power Mode or an unavailable network prevents it.

Content edits patch shared resources immediately, roll back on failure, and adopt canonical responses. Pending message bubbles keep the immutable client UUID through retry and confirmation; uncertain payloads cannot be edited. Membership or ordering that cannot be derived refreshes on the affected screen's next appearance. Transport invalidation follows resource families and fences only matching in-flight reads. Notification housekeeping and read receipts preserve content snapshots; activity receipts patch acknowledged rows so they are not sent repeatedly.

Sign-out erases local credentials, response files and the remembered identity before its signed network request. Session expiry, restricted sessions, authentication, security changes and API/account transitions erase both cache tiers, drafts and feature resources. Authentication stops before installing another token if disk erasure fails. Account and resource generations fence late network responses, token rotation and rollback callbacks. Forbidden or missing responses evict snapshots and hide displayed content. Share extensions retain their pinned, read-only credential checks and use memory only. This is a response cache, not an offline write synchronization system.

Run the `IndexCoreTests` and `IndexFeaturesTests` with Swift/Xcode on a Mac, and `python3 apps/ios/Scripts/check-sharing-source.py` from the repository root. SwiftUI and protected-file behavior require Apple tooling: build the `Index` simulator scheme and the macOS preview, then verify slow/offline cold loads, tab/back navigation, placeholder timing and geometry, pagination during refresh, optimistic failure/retry, foreground/background request counts, notification navigation and all account/security transitions. Check cache protection and backup exclusion on a device, including before first unlock.

For cached launch, confirm that the first frame contains the cached feed and tabs with no session placeholder, and that only get-session runs before verification. Exercise offline retry and same-account recovery without resetting navigation or drafts; mismatch, restriction, null session and 401 must drop cached content and drafts. Check wrong-password/taken-username feedback, author-to-profile completeness, clearing Discover during idle warm-up, connection removal/count/privacy rollback, normalized custom group names and protected group edits. Trace password/email changes for a single restoration and conversation/sheet transitions for pulse and push-focus request counts.

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

For quick-add on both the feed and your profile, focus an empty field, then type a partial URL. Tap blank space, a link, the destination menu, and the active tab; each outside tap should dismiss the keyboard while the tapped control still works. Reopen the field and confirm the draft remains, then check cursor placement, text selection, and paste. Drag down through a vertical scroll area into the keyboard to dismiss it, including with an empty list. Switching tabs must release focus, and switching back must not restore it. Dismissal alone must not send a save request or show an extra keyboard toolbar.

## Distribution

Archive the `Index` scheme and upload it from Xcode's Organizer. Endpoints and the signing team come from the ignored `Config/Local.xcconfig`; scope the endpoints to Release so Debug keeps the fixture backend:

```
INDEX_API_URL[config=Release] = https:/$()/api.example.com
INDEX_WEB_URL[config=Release] = https:/$()/index.example.com
```

`Resources/PrivacyInfo.xcprivacy` is the app's privacy manifest. It declares UserDefaults (`CA92.1`) for device-local theme and notification state, and file timestamps (`C617.1`) for pruning response files inside the app container, following [Apple's required-reason API declarations](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api). Declare any additional required-reason API use there. The Share extension uses memory only and does not access these files or UserDefaults, so it has no manifest; add one if that changes. `Config/Info.plist` declares that the app uses only exempt encryption (HTTPS and Keychain).

The generated project sets build number `1` for the app and Share extension. Each upload needs a higher one: Xcode's upload option "Manage Version and Build Number" (on by default) assigns it to every bundle, or pass `CURRENT_PROJECT_VERSION=N` to `xcodebuild archive`. `Local.xcconfig` cannot override it because target settings take precedence.

## Readable links

Profiles, collections, post sharing and inbound links use the shared [readable route contract](../../docs/readable-routes.md). Set `INDEX_WEB_URL` to the canonical web origin and optional comma-separated `INDEX_WEB_ALIASES` for aliases. Universal links also require the final associated-domain/AASA/signing setup. Run the route, account-lifetime and navigation tests with the documented Swift/Xcode checks on a Mac before distribution.

## Group management

Settings manages personal link collections using the same compact lock control as the group editor. New groups default unlocked; Starred is always private. Profile creation selects the returned group automatically. See the [group visibility rules](../../docs/api.md#visibility-and-groups).

## Share extension

`IndexShare` is a real embedded iPhone/iPad Share extension; `IndexShareMac` supplies the Tauri macOS bundle. Shared picker/group creation lives in `IndexSharing`/`IndexUI`. Both require explicit shared Keychain signing and a one-time sign-in when upgrading from legacy storage. See [sharing implementation, configuration and exact Mac checks](../../docs/sharing.md).
