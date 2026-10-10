# Share into Index

The iPhone/iPad and macOS Share extensions save one HTTP(S) URL to **Your links** (no group) or one owned custom group, in the server's current UTC week. The picker has search, recognizable lock rows, and Create group. Creating selects the full returned group and returns to the picker. Starred, Favorites, conversations and other people's groups are not save destinations. Groups exist inside this picker; there is no promise that Apple will suggest or pin a group in the system share sheet.

Web/Tauri quick-add keeps paste/Enter-to-save. Its adjacent destination button uses the same picker and embedded group form. A previously saved URL offers View existing and Save again. View existing rechecks canonical routing/access. The native extension presents the authorized existing post inside the share panel, without using unsupported techniques to launch the containing iOS app. Nothing is sent directly to another person.

A refreshed selection uses the group's current name and visibility. A complete list confirming deletion marks the destination unavailable and requires a fresh choice; it never silently falls back to Your links. Partial pagination does not establish deletion. The server rechecks ownership/custom-group eligibility at every save/replay. Locking an owned destination still permits its owner to save there; an unlocked group continues to respect profile privacy.

## Reusable contracts

`POST /api/v1/links/share` / `links.share` accepts `{ url, groupId: UUID | null, requestId: UUID, saveAgain: boolean }` and returns `{ status: "saved" | "existing", link: <full link> }`. It requires a fresh verified session. `groupId` defaults to null; `saveAgain` defaults to false. It deliberately does not accept recipients, multiple groups, owner IDs or a save date.

Duplicate detection compares the trimmed URL against all links owned by the account, including different groups and old weeks. It does not strip fragments/tracking parameters or equate different URLs by fetching redirects. Choosing a different destination does not move an existing save; Save again explicitly creates another original in the selected destination/current week.

`20261010104011_link_sharing` adds `share_receipts` and the `index_share_link` PostgreSQL function. The function serializes sharing attempts on the owner row, locks/rechecks the destination, detects duplicates, and writes the link and immutable account/request/payload receipt in one database transaction. It works with Neon HTTP without interactive transaction support. Different request IDs cannot race an ordinary share into duplicate originals. An explicit Save again uses a new operation ID, and retries of that operation return its original result. Payload reuse conflicts. Receipts survive deletion with a null link reference and refuse resurrection. Replays recheck the destination and return only currently accessible links. Receipt rows remain until account deletion; do not prune them without defining a retry expiration contract. Metadata fetches are bounded by the existing SSRF-safe reader, before the transaction.

Web exports `DestinationPicker({ value: Group | null, onChange, disabled? })`, `useDestinationStatus`, `ShareAttempt`, and `useShareSave()` under `features/sharing`. The picker owns a stable focus-return ref; embedded creation propagates pending state to block dismissal. The save hook uses `accountMutationOptions` and checks the account generation after awaited mutation completion, including cache invalidation. Later menu-bar windows must use the normal verified auth/Query/Router contexts and retain `DesktopTheme` per-window integration. Their selected group must be checked through `useDestinationStatus`, with `unavailable` blocking Save.

Native `IndexSharing.ShareModel` / `SharePanel` use `IndexCore.ShareDraft`, the same endpoint, and the canonical `ReadableRoutes` resolver for View existing. `IndexUI` contains the extracted semantic palette, shared group lock control and cancellable `GroupCreationForm`, also used by `GroupEditorView`. No notification or menu-bar runtime is added. AppModel's pending readable-route/verified-session observer is preserved.

## Secure host/extension session boundary

Both extension targets read the host's signed Better Auth bearer credential from an explicitly configured shared Keychain group. They never write, rotate or erase it. No token passes through UserDefaults, files, app groups, launch URLs or the clipboard. No app-group container is required. Network cookies/redirects remain disabled. Each extension client pins its initial credential, compares the secure store before and after asynchronous requests, rechecks the verified account before saving, and discards account content if the identity changes. Signing in or verifying happens in Index with a password-based session; the user returns to the still-open share panel and chooses Retry session.

Credential attributes:

- Generic password; service `com.generalpursuit.index.session.<normalized API URL>`; account `session`.
- Access group from the built Info.plist `IndexKeychainGroup`, supplied by `INDEX_KEYCHAIN_GROUP`; both signed targets must be entitled to it.
- `WhenUnlockedThisDeviceOnly`; on macOS `kSecUseDataProtectionKeychain = true`.
- API normalization lowercases scheme/host, removes default 443/80 ports and all trailing path slashes, and retains case-sensitive internal paths and percent encodings. Userinfo, query, fragment, whitespace, backslashes, invalid ports, dot segments and encoded path separators are rejected. HTTPS is required except loopback development. `APIScope.swift`, the Rust-called Objective-C bridge and build helper share fixture vectors in `Tests/IndexCoreTests/Fixtures/api-scopes.json`; the Swift/Rust tests still need a Mac run.

**Transition is a deliberate one-time sign-in.** Older macOS builds used keyring service `com.generalpursuit.index`, account `INDEX_API_SERVER`; iOS used an unshared service containing raw `server.absoluteString`. The new shared namespace does not import or read those entries. A configured shared build returns missing/shared-Keychain errors directly and never falls back to legacy credentials. Signing out clears the configured credential; no migration can resurrect it. Unconfigured non-sharing desktop builds retain legacy storage; native-smoke always uses its separate smoke service. An older installed binary can still have its own old session: remove obsolete builds or revoke those sessions separately when rolling out.

A distinct non-account Keychain item (`com.generalpursuit.index.appearance`, account `device`) carries only System/Light/Dark to the extension. Hosts copy their existing device preference there without changing preference ownership. The extension reads it when opened, defaults to System if unavailable, and uses the shared semantic palette. It never changes the session item. Sign-out leaves appearance intact. Tauri `set_appearance(preference,resolved)` still updates each window's native chrome/background.

Input and the request ID stay in extension/quick-add memory through recoverable errors. Cancellation cancels client tasks and closes the OS request; a server write may already have committed. Reopening and sharing ordinarily detects that existing link; a second original always requires an explicit Save again. Extension process termination loses unsaved input, as it does for other ephemeral share panels. Invalid/missing/multiple shared URLs show an editable field with feedback. The UI stays scrollable for small sheets/Dynamic Type. Account loss clears groups, selection and existing-post data, while retaining the user-supplied URL for retry.

## iPhone/iPad build and signing

The checked-in Xcode project includes real `IndexShare` and `IndexShareMac` app-extension targets and shared schemes. The iOS `Index` target depends on `IndexShare` and embeds its `.appex` in PlugIns. `APPLICATION_EXTENSION_API_ONLY=YES` applies to extension targets. The principal class loads URL/text `NSItemProvider` attachments; activation accepts one web URL or text. Regenerate deterministically with `python3 apps/ios/Scripts/generate-project.py`.

Configure `apps/ios/Config/Local.xcconfig` from the example. Both app and extension require the same `INDEX_API_URL`, provisioned `INDEX_KEYCHAIN_GROUP`, and Apple team. The default group suffix is `com.generalpursuit.index.shared`; `$(AppIdentifierPrefix)` includes the trailing dot and is not necessarily your team ID. Register/sign both bundle identifiers (`com.generalpursuit.index`, `com.generalpursuit.index.share`) and provision Keychain Sharing for both. Keep the host's APS entitlements when integrating notifications; the Share extension itself needs no APS entitlement. Canonical/alias web hosts remain deployment inputs (`INDEX_WEB_URL`, `INDEX_WEB_ALIASES`). No Apple identifiers, domain or credential is provisioned by this change.

On a Mac with full Xcode, first compile without signing:

```sh
cd apps/ios
swift test
xcodebuild -project Index.xcodeproj -scheme Index -configuration Debug \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project Index.xcodeproj -scheme IndexShareMac -configuration Debug \
  -destination 'generic/platform=macOS' CODE_SIGNING_ALLOWED=NO build
```

Unsigned simulator builds verify compilation only. A signed simulator/device install is needed to verify Keychain sharing, extension launch and lifecycle. Use Xcode's Index scheme for iPhone/iPad and inspect the built app's PlugIns/IndexShare.appex. Select Safari as the extension scheme's host when debugging. Do not claim the share target works merely because the host app launches.

## Tauri macOS packaging

`bun run desktop:build` on macOS builds `IndexShareMac` with Xcode before Tauri packages it through `bundle.macOS.files` at `Contents/PlugIns/IndexShareMac.appex`. It adds the host shared-Keychain entitlements and embeds its provisioning profile before signing. Tauri's installed CLI schema supports this file/Info.plist/entitlements configuration; its [2.11.4 bundler source](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/macos/app.rs) copies custom files before signing the host. The extension is already signed with its own sandbox/network/Keychain entitlements. A final verifier checks both signatures, matching API/group/version and extension sandbox rights. It decodes both embedded provisioning profiles in memory and checks expiry, team, application identifier/prefix and authorization for every signed Keychain group against the actual signed entitlements. Profile and credential contents are never printed. Actual OS acceptance, extension discovery and device launch remain separate Mac checks.

Use your actual signing/profile values. The web origin may later be `https://i.generalpursuit.dev`, with `index.generalpursuit.dev` as an alias, but neither is assumed provisioned. Example for a disposable local API:

```sh
cd apps/web
VITE_SERVER_URL=http://localhost:3702 INDEX_WEB_URL=http://localhost:4873 \
INDEX_APPLE_TEAM_ID=YOURTEAMID INDEX_KEYCHAIN_GROUP=YOURPREFIX.com.generalpursuit.index.shared \
APPLE_SIGNING_IDENTITY='Apple Development: Your Name (YOURTEAMID)' \
INDEX_MAC_HOST_PROFILE=/absolute/path/IndexHost.provisionprofile \
  bun run desktop:build --local --bundles app
```

Register a macOS host App ID and `com.generalpursuit.index.share-mac` with the same shared group. For manual extension signing, also set `INDEX_MAC_EXTENSION_PROFILE_SPECIFIER` to the installed profile's name/UUID. Distribution uses an appropriate Developer ID identity/profile and your existing notarization configuration; HTTPS endpoints are required without `--local`. `--target aarch64-apple-darwin`, `x86_64-apple-darwin` and `universal-apple-darwin` build matching extension architectures. Changing the host bundle ID also requires updating the extension IDs in the generator/profiles.

`--without-share-extension` produces an explicitly limited host-only build for local shell development; it does not implement native sharing. The existing `desktop:test` smoke flow uses its isolated legacy credential service and omits the extension. Normal sharing builds fail if signing/provisioning inputs are missing; they never silently ship a mock. Tauri `desktop:dev` alone does not register an extension. No Mac binary was built or launched on the Linux VM.

After installing the signed bundle in Applications, enable Index in macOS Settings > Privacy & Security > Extensions > Sharing if the OS has not enabled it. Verify registration using `pluginkit -m -A -D -i com.generalpursuit.index.share-mac`; do not remove or kill other extensions. Verify the final bundle again with:

```sh
python3 scripts/verify-share-bundle.py src-tauri/target/release/bundle/macos/Index.app
```

Apple's [Keychain sharing guide](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps) explains the common access-group/signing requirement. The [macOS Keychain note](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains) explains why the macOS bridge explicitly uses the data-protection Keychain. These are launch requirements, not evidence that signing has been verified here.

## Verification and remaining Mac checks

Linux checks use isolated PGlite data and assigned ports 3702/4873:

```sh
bun test packages/api/src/features/links/sharing.test.ts apps/web/tests/sharing.test.ts
python3 apps/ios/Scripts/check-sharing-source.py
python3 apps/web/scripts/test-share-profiles.py
cd apps/web && VITE_SERVER_URL=http://localhost:3702 bun run check-types
# Workspace runner owns display :177 and cleans its processes:
E2E_PRODUCTION=1 python3 /home/ono/index/.git/t3-feature-rollout/run-browser-tests.py \
  --feature sharing -- sharing.spec.ts groups.spec.ts app.spec.ts feed.spec.ts desktop.spec.ts
```

Linux verification completed on 2026-10-10: 93 targeted Bun API/security/route/group/client tests passed; 30 production headed browser cases passed, including all five sharing scenarios, group flows, weekly quick-add and the desktop auth bridge. Web/API type checks, Vite production build, server types, scoped lint, four packaging/security source checks and seven synthetic decoded-profile validation tests passed. The runner launched and cleaned the disposable API, preview server and owned Xvfb/Chromium. No live account, database, deployment or production credential was used.

The source checks inspect/reproduce targets, activation rules, embedding, entitlements and read-only credential boundaries. They do not compile Swift, Objective-C or Rust. Native unit tests cover shared URL validation, immutable retry IDs, normalization, selected-group refresh/deletion and credential races. The existing serialized live Swift suite now also tests sharing/duplicate/save-again through a read-only API client.

For native live tests, start only the disposable server with `E2E_API_PORT=3702 E2E_WEB_PORT=4873 bun e2e/server.mjs` from `apps/web`; then from `apps/ios` run `INDEX_NATIVE_INTEGRATION=1 INDEX_NATIVE_TEST_PORT=3702 swift test --filter LiveAPITests`. Do not run browsers or a different native suite that resets this fixture simultaneously. From `apps/web/src-tauri`, run `VITE_SERVER_URL=http://localhost:3702 cargo test`, including the shared Swift/Rust normalization fixtures. Repeat the signed smoke/API/Keychain checks after packaging; the old host-only smoke is not proof of sharing.

On signed iPhone, iPad and macOS installations exercise:

1. Safari Share -> Index, plain text URL, no/invalid URL, duplicate representations and multiple URLs. Verify one destination, search through more than 100 groups, creation with lock/unlock and immediate returned selection, cancel and keyboard/VoiceOver/Dynamic Type. No OS suggested group recipients are promised.
2. Your links under public/private profiles, owned locked/unlocked groups, group rename/privacy changes and deletion during a panel's lifetime. Refresh destinations; a missing choice must block Save until explicitly replaced. UTC week rollover and a duplicate from an old week must retain correct semantics.
3. View existing (fresh route/access resolution), Save again, slow/offline networking, lost response followed by retry, repeated taps, cancel while saving, extension termination/reopen and host force quit. Count persisted links to verify no accidental duplicate.
4. Fresh install/one-time sign-in, signed out, restricted unverified account, verification then Retry session, sign-out/account switch while loading/creating/saving, locked Keychain, revoked session and another API origin/base path. Old identity content must disappear and extension callbacks must not rewrite host credentials.
5. System/Light/Dark, native primary foreground contrast, host theme changes followed by reopening the extension, and untouched per-window DesktopTheme behavior. Observe that host notification polling (after supervisor integration) still reads `session::session_read()` correctly while the host is hidden; sharing itself adds no notification code.
6. Archive/sign/export iOS, inspect the exported `.appex` entitlements, sign/notarize the macOS distribution bundle, install cleanly, verify Keychain permissions and actual OS extension discovery. These remain Mac/device/provisioning checks; this Linux work makes no claim that they passed.
