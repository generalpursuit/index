# Desktop releases

Work on `dev`, promote tested changes to `staging`, then promote the approved
staging commit to `main`. A push to either release branch runs CI and builds all
desktop targets. The Desktop release workflow can also be run manually on either
branch. A run on any other branch does not release anything.

| Branch    | Installed app | Service    | GitHub environment   | Update channel |
| --------- | ------------- | ---------- | -------------------- | -------------- |
| `main`    | Index         | Production | `desktop-production` | `production`   |
| `staging` | Index Staging | Staging    | `desktop-staging`    | `staging`      |

Both apps can be installed together. They have separate bundle/application IDs,
credential stores, app data, macOS Share extensions, signing keys for updates,
and update feeds. Staging shows a visible badge and an S in its macOS menu-bar
item. Installing a staging update cannot turn the production app into staging.

## Artifacts and updates

- macOS 14+: Apple Silicon and Intel DMGs, plus signed updater archives.
- Windows x64: per-user NSIS installer. Windows publisher signing is not yet
  configured; installers are unsigned and may show SmartScreen warnings.
- Linux x64: AppImage, DEB and RPM, built on Ubuntu 22.04. In-app updates apply
  to AppImage; install newer DEB/RPM packages with your package installer.

macOS releases require Developer ID signing and Apple notarization. Every
platform's updater payload is signed with its channel's independent Tauri key.
The app checks on launch and every four hours. Settings → Desktop updates offers
an explicit install-and-restart action; no update is installed without it.

Artifacts live in [GitHub Releases](https://github.com/generalpursuit/index/releases).
Tags are `desktop-production-vVERSION` and `desktop-staging-vVERSION`. Production
is the latest stable release; staging is a prerelease. Each release includes
`SHA256SUMS.txt`. The version is the base major/minor in
`apps/web/src-tauri/tauri.conf.json`, with the workflow run number added to its
patch component (for example, base `0.1.0` and run 42 produce `0.1.42`). Do not
decrease the base version. Rerunning a failed job retains its version; starting a
new workflow advances it. Installer limits are checked before building.

Publication requires successful CI and all four native targets. The publisher
uploads an unpublished draft first, publishes the complete release, then commits
only that channel's `latest.json` on the `desktop-updates` branch. Feed updates
are atomic and refuse older versions. A failed build leaves the current feed
unchanged. If publication succeeds but the feed commit fails, rerun the failed
publish job: it verifies the existing checksums and resumes without replacing
published files. A full rebuild produces different signed bytes; start a new run
instead of overwriting a published version. To roll back application code, revert
the code and release a higher version.

The repository must be public for unauthenticated downloads and in-app updates.
While it is private, repository members can download installers through GitHub,
but the app cannot read the public feed. No repository credential is embedded in
an installer. Changing repository visibility remains a separate owner action.

## One-time Apple setup

The two GitHub environments allow only their corresponding release branch. Their
secrets are separate from the existing web deployment environments.

Run the setup helper on the Mac holding the exported **Developer ID Application**
certificate and private key. `Apple Development` is not a distribution identity.
The helper sends credentials directly to GitHub using your authenticated GitHub
CLI; do not put the `.p12`, its password, or a notarization key into chat or Git.

Prerequisites: Python 3, [GitHub CLI](https://cli.github.com/) authenticated with
repository administration access (`gh auth login`), and Bun or Node.js. From a
checkout containing these changes:

```sh
python3 apps/web/scripts/setup-desktop-signing.py
```

The Terminal prompts for the `.p12` path; drag the file from Finder and press
Enter. The password prompt is hidden. This
configures both environments and generates two independent, encrypted updater
key pairs. When generating a new pair, Tauri asks for that same password twice
through hidden Terminal prompts. Passwords are never passed as command-line
arguments. Back up `~/Library/Application Support/Index Release Keys` and retain
the export password. Future releases must use these same keys. The helper refuses
to replace an existing public key with a different pair.

To finish notarization and the shared-Keychain Share extension, provide:

1. An [App Store Connect team API key](https://v2.tauri.app/distribute/sign/macos/)
   for notarization, its Key ID, and its Issuer ID. Download the `.p8` on your Mac.
2. Four Developer ID provisioning profiles, issued for the same signing team and
   certificate. The host and extension in each channel must authorize their
   shared Keychain access group. Use the actual App ID prefix (which can differ
   from the Team ID).

| Profile filename                        | Explicit App ID suffix                       | Shared Keychain group                            |
| --------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| `production-host.provisionprofile`      | `com.generalpursuit.index`                   | `PREFIX.com.generalpursuit.index.shared`         |
| `production-extension.provisionprofile` | `com.generalpursuit.index.share-mac`         | `PREFIX.com.generalpursuit.index.shared`         |
| `staging-host.provisionprofile`         | `com.generalpursuit.index.staging`           | `PREFIX.com.generalpursuit.index.staging.shared` |
| `staging-extension.provisionprofile`    | `com.generalpursuit.index.staging.share-mac` | `PREFIX.com.generalpursuit.index.staging.shared` |

Save those profiles in one folder, then run (substitute your local paths and IDs):

```sh
python3 apps/web/scripts/setup-desktop-signing.py /path/DeveloperID.p12 \
  --notary-key /path/AuthKey.p8 --key-id YOUR_KEY_ID --issuer YOUR_ISSUER_ID \
  --profiles /path/desktop-profiles
```

It is safe to rerun with the same updater key backups and password. CI validates
profile identities, expiry, distribution entitlements and Keychain groups,
imports the certificate into a temporary keychain, and removes its local signing
credentials afterward. It checks the packaged Share extension, notarization
ticket, and Gatekeeper acceptance before uploading artifacts.

If the certificate and notarization setup is already complete, upload profiles
without opening or re-uploading any private key or asking for a password:

```sh
python3 apps/web/scripts/setup-desktop-signing.py \
  --profiles-only --profiles /path/desktop-profiles
```

This mode validates all four profiles against the existing signing team before
uploading them. It updates only the profile secrets and App ID prefix variables.
The GitHub CLI encrypts secret values locally before uploading them to GitHub.
Authorized release jobs can access those secrets during signing; making the
repository public does not publish the secret values.

The helper sets these values in **both** environments:

| Secrets                              | Variables                           |
| ------------------------------------ | ----------------------------------- |
| `APPLE_CERTIFICATE` (base64 `.p12`)  | `APPLE_SIGNING_IDENTITY`            |
| `APPLE_CERTIFICATE_PASSWORD`         | `INDEX_APPLE_TEAM_ID`               |
| `APPLE_API_KEY_CONTENT`              | `APPLE_API_KEY`, `APPLE_API_ISSUER` |
| `INDEX_MAC_HOST_PROFILE_BASE64`      | `INDEX_APP_ID_PREFIX`               |
| `INDEX_MAC_EXTENSION_PROFILE_BASE64` | `INDEX_UPDATER_PUBLIC_KEY`          |
| `TAURI_SIGNING_PRIVATE_KEY`          |                                     |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |                                     |

## Verification and first release

The Desktop native checks workflow compiles and tests macOS, Windows, and Linux
without signing secrets. It runs for relevant changes on `dev` and pull requests.
The release workflow also runs the reusable application CI before building.
Both Mac architectures use macOS 15 runners with Xcode 16.4 selected explicitly
for the Share extension's Swift 6 package. The packaged app still targets macOS 14.

Local focused checks:

```sh
bun test apps/web/tests/desktop-release.test.mjs apps/web/tests/desktop-publish.test.mjs
python3 apps/web/scripts/test-desktop-signing.py
cd apps/web
bun run check-types
bun run test:e2e e2e/desktop-updates.spec.ts
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

For the first release, configure all Apple inputs, make the repository public,
promote to `staging`, and install its artifacts on the actual operating systems.
Check login, external links, macOS Share, and installing a second staging release
through Settings. Install production alongside staging and confirm independent
sessions. Promote the tested commit to `main` after that acceptance check. Native
compilation and a mocked browser bridge cannot establish successful installation,
Gatekeeper behavior or a real update on each OS.

Windows publisher signing is a separate follow-up using a Windows certificate or
signing service; an Apple certificate cannot sign Windows installers. See
[Tauri's Windows signing guide](https://v2.tauri.app/distribute/sign/windows/).
