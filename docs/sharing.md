# Share into Index

Web/Tauri quick-add and the iOS/macOS Share extensions save one HTTP(S) URL into the current UTC week. Destinations are Your links (`groupId: null`) or an owned custom group; Starred, Favorites and conversations are not destinations.

A selected group follows its current name/visibility. Only a complete successful list can establish deletion; a missing destination blocks saving until explicitly replaced, never silently falling back to Your links. Group creation selects the returned group immediately. The server rechecks ownership and eligibility on every save and replay.

## Duplicate saves and retries

[links.share](../packages/api/src/features/links/sharing.ts), exposed at `POST /api/v1/links/share`, takes `url`, `groupId`, `requestId` and `saveAgain`. It returns `saved` or `existing` with the full link. Ordinary duplicate detection compares the trimmed URL across the account's groups and weeks; it does not strip tracking parameters or resolve redirects. Choosing another destination does not move an existing save. Explicit Save again uses a new request ID and creates another original.

The database commits the link and an immutable account/request/payload receipt together. **An uncertain result retains the original ID and payload for retry.** Reusing an ID with different contents conflicts. Receipts survive link deletion and cannot resurrect it; replay rechecks current access and destination eligibility. Do not prune receipts without defining a retry-expiration contract.

Cancellation cannot retract a write that already committed. Ordinary resubmission after extension termination finds the existing link; another original requires Save again. View existing resolves current route access. The iOS extension displays it within its panel rather than forcing the host app to open.

## Secure host/extension session boundary

Extensions read the host's signed bearer token from the configured shared Keychain group. They **never write, rotate or erase it**. Each pins its initial credential, compares secure storage around asynchronous requests, verifies the account before saving, and discards old account content on change. Verification/sign-in happens in the host; the extension can retry the session afterward. Cookies and redirects are disabled.

The generic-password item uses service `com.generalpursuit.index.session.<normalized API URL>`, account `session`, `WhenUnlockedThisDeviceOnly`, and the built `IndexKeychainGroup`. macOS uses the data-protection Keychain. Both signed targets must be entitled to the configured group; the App ID prefix is not necessarily the Team ID. API scope normalization is shared through [fixture vectors](../apps/ios/Tests/IndexCoreTests/Fixtures/api-scopes.json): preserve base-path identity and reject unsafe URL forms. Tokens never pass through URLs, browser storage, files or the clipboard.

Moving from legacy unshared storage requires one deliberate sign-in. Shared builds never fall back to or resurrect legacy credentials after sign-out. Non-sharing desktop builds and native smoke tests retain their separate namespaces. Old installed binaries may still hold old sessions; revoke those separately when retiring them.

Appearance uses a separate non-account Keychain item carrying only System/Light/Dark. Hosts own it; extensions read it and default to System if unavailable. Sign-out leaves appearance intact. Notification installation proof is also separate from the session item.

## Native packaging and checks

The [iOS project](../apps/ios/README.md) owns `IndexShare` and `IndexShareMac`; the iOS host embeds its extension. Configure the same API scope and shared Keychain group for host and extension. Preserve the host's APS entitlement; the extension itself needs no push entitlement.

On macOS, `bun run desktop:build` from `apps/web` builds and embeds the real extension and requires its signing/profile inputs. Missing inputs fail the build. [Release prerequisites](desktop-releases.md#artifacts-and-prerequisites) and [local host-only builds](../apps/web/README.md#desktop) are distinct. The latter, `desktop:dev` and `native-smoke` do not validate sharing.

From the root:

```sh
bun test packages/api/src/features/links/sharing.test.ts apps/web/tests/sharing.test.ts
python3 apps/ios/Scripts/check-sharing-source.py
python3 apps/web/scripts/test-share-profiles.py
```

These check contracts and packaging structure. Use the [iOS native checks](../apps/ios/README.md#checks) for compilation and fixture integration. After a signed macOS build, verify its bundle from `apps/web`:

```sh
python3 scripts/verify-share-bundle.py src-tauri/target/release/bundle/macos/Index.app
```

On signed iPhone, iPad and macOS installations, verify OS extension discovery, shared Keychain access, duplicate/retry/cancel behavior, deletion of a selected group, and account switches during saving. Include keyboard, VoiceOver/Dynamic Type and appearance. A host launch or mocked bridge cannot establish extension behavior.
