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
- `Sources/IndexApp/IndexApp.swift`: authenticated root, navigation, tabs, app session and in-memory conversation drafts.

Navigation uses `NavigationStack`, including native back gestures. The feed uses native vertical paging: content moves with the gesture and settles on one week, with own links above a horizontally scrolling carousel. Empty weeks show a compact invitation to add a link, plus discovery guidance when the user follows nobody. Longer link collections have independent scroll/pagination; explicit week arrows remain available when inner scrolling or large accessibility text makes a vertical week gesture ambiguous. Forms and chat composers follow the keyboard safe area. System share sheets and native menus retain platform behavior while cards, typography, colors, and spacing follow the web design.

Messages refresh while the conversation is active, conversations and activity poll while foregrounded. There are no push notifications or offline database in the current backend contract. Drafts remain in memory until sent or signed out. Unknown send outcomes retain the original UUID and payload for an idempotent retry. Restricted forwards show only author identity; locked/deleted originals show an unavailable state.

## Authentication

Only Better Auth's signed `set-auth-token` header is retained. Native requests do not use cookies, and tokens are never stored in UserDefaults. Keychain entries are scoped to the API URL and use `WhenUnlockedThisDeviceOnly`. Session expiry/sign-out erase credentials and account state. The transport rejects remote HTTP and redirects; it accepts HTTP only for loopback development. The backend remains responsible for all content permissions.

## Checks

```sh
swift test
# With the disposable API running on localhost:3002:
INDEX_NATIVE_INTEGRATION=1 swift test
```

The integration test resets **only the disposable fixture API** and checks real signed login/restoration, weekly pagination, Favorites, comments, private forwarding, send retries, replies, follow requests, group locking, and logout. It does not use production credentials or databases. Do not run it concurrently with browser tests that use that fixture server.

On this Mac's command-line-only installation, source compilation succeeded against the installed macOS 26.5 SDK. Tests require explicitly loading the installed Testing plugin/runtime; `Scripts/check-local.sh` captures that workaround. The latest run passed twelve unit tests (including a real Keychain round trip and authentication error cases) and the real-API integration test. These checks do not establish iPhone layout or simulator behavior. Full Xcode is still required for simulator/device verification, signing, and an iOS archive.

Before distribution, verify at small and large iPhone sizes and iPad, with the software keyboard, landscape orientation, VoiceOver, and large Dynamic Type. Exercise Keychain restore after force quit, native back gestures, privacy changes, and private forwards between separate accounts.
