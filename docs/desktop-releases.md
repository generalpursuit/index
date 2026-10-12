# Desktop releases

Promote tested work from `dev` through `staging` to `main`. The manually dispatched [release workflow](deployment.md#release-deployment) publishes desktop apps only from `staging` or `main`, after CI and all native targets pass and the API is deployed.

| Branch    | Installed app | GitHub environment   | Channel      |
| --------- | ------------- | -------------------- | ------------ |
| `staging` | Index Staging | `desktop-staging`    | `staging`    |
| `main`    | Index         | `desktop-production` | `production` |

[Channel configuration](../apps/web/scripts/desktop/channels.ts) binds each app to its service, identity and feed. The channels have separate credentials, app data, Share extensions and updater keys; they can be installed together. A staging update cannot convert the production app. Release builds select `--channel staging` or `--channel production` and reject development overrides.

## Artifacts and prerequisites

Targets are macOS 14+ Apple Silicon/Intel DMGs and updater archives, Windows x64 per-user NSIS, and Linux x64 AppImage/DEB/RPM. Windows publisher signing is not configured. Linux in-app updates apply to AppImage; DEB/RPM use their package installer.

Tauri skips its Finder-scripted DMG layout on CI, so [dmg.ts](../apps/web/scripts/desktop/dmg.ts) packages and signs the DMG with the hash-pinned dmgbuild in [dmgbuild-requirements.txt](../apps/web/scripts/desktop/dmgbuild-requirements.txt). Local DMG builds need it on `PATH` or `DMGBUILD`. The window background is [background.svg](../apps/web/src-tauri/dmg/background.svg) and its rendered PNGs.

macOS distribution requires valid Developer ID signing, notarization and host/Share-extension profiles authorizing the channel's shared Keychain group. Every platform requires that channel's existing Tauri updater signing key. The release workflow owns those build inputs and validation; retain the updater key across releases.

Public unauthenticated GitHub downloads are required for in-app updates. Private repository members can download installers manually; no repository credential is embedded in an app.

[Updates](../apps/web/src-tauri/src/updates.rs) are checked at launch and hourly, then downloaded, verified and installed without asking; the new version runs the next time the app opens. Windows cannot replace a running app, so it keeps the verified installer and runs it silently on quit. Settings can restart into a waiting update sooner. When the API rejects the running version, the app restarts into the newest release itself.

## Publication and recovery

Artifacts publish to [GitHub Releases](https://github.com/generalpursuit/index/releases) with `SHA256SUMS.txt`. Tags are `desktop-<channel>-vVERSION`; staging is a prerelease. [tauri.conf.json](../apps/web/src-tauri/tauri.conf.json) reads the product version from the root `package.json`; staging builds add `-staging.<run>`, so a new staging run advances the version without a bump. Rerunning a failed job retains its version.

The [publisher](../apps/web/scripts/desktop/publish.ts) uploads a draft, publishes a complete release, then atomically advances only that channel's `latest.json` on `desktop-updates`. It refuses an older feed version. Failed builds leave the current feed intact.

If publication succeeds but the feed update fails, rerun the failed publish job: it verifies the existing checksums and resumes. Do not rebuild and overwrite a published version; newly signed bytes differ. Roll back code by reverting it and releasing a **higher** version.

## Checks

From the root:

```sh
bun test apps/web/scripts/desktop/release.test.ts apps/web/scripts/desktop/publish.test.ts
python3 apps/web/scripts/test-desktop-signing.py
```

[Desktop native CI](../.github/workflows/desktop-checks.yml) compiles the supported platforms without release credentials. [Local desktop checks](../apps/web/README.md#desktop-checks) cover development; native compilation alone does not verify installation, Gatekeeper, extension discovery or actual updates.

Before promotion, install staging on the target operating systems, exercise login/external links/macOS Share, and update it to a second staging version. Keep production installed alongside it to verify independent sessions and update channels.
