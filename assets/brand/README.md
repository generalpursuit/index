# Brand artwork

This folder is the canonical artwork source shared by web, desktop and iOS; it is
not a package. The supplied SVG and PNG files come unchanged from
`index-geist-original-hop-square-ink.zip` (Geist, Original icon, hop square, Ink).
The wordmark is outlined Geist 600 and needs no installed font; consult the
original typeface licence before reusing it outside this project.

Ink uses background `#0B0B0C` and symbol `#FFFFFF`. Paper swaps only those colors,
preserving the exact paths, scale and placement.

| Source                          | Use                                                                     |
| ------------------------------- | ----------------------------------------------------------------------- |
| `symbol/symbol-white.svg`       | Web Home symbol and shared SwiftUI template image                       |
| `symbol/symbol-black.svg`       | Desktop menu-bar vector PDF                                             |
| `wordmark/wordmark-white.svg`   | Web and shared SwiftUI wordmark                                         |
| `app-icon/app-store-1024.png`   | Opaque square iOS Ink icon; web icons and Ink previews                  |
| `app-icon/app-icon-square.svg`  | macOS bundle/Dock icons; Paper iOS icon and previews after palette swap |
| `app-icon/app-icon-rounded.svg` | Windows/Linux bundle icons and web ICO fallback                         |
| `app-icon/favicon.svg`          | Explicit web SVG favicon                                                |

The other wordmarks, symbols, lockups, PNG sizes and rounded exports remain useful
brand resources. They are retained even when no current application imports them.

## Generate and check

Run from the repository root after installing the locked dependencies:

```sh
bun assets/brand/sync.ts --target web
bun assets/brand/sync.ts --target desktop
bun assets/brand/sync.ts --target ios
bun assets/brand/sync.ts --target web --check
```

Repeat `--target` to select several platforms; omitting it selects all three.
`--check` regenerates selected outputs in temporary staging, reports missing or
stale files, and never repairs them. Generation checks all selected prerequisites
first, stages and validates every output, then copies them into the repository.
Generated assets stay committed, so normal builds need no conversion tools.

| Target    | Prerequisites                                                     | Generated destinations                                                                                                      |
| --------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `web`     | Repository's locked Tauri CLI                                     | `apps/web/public`: SVG/ICO favicons, 192/256/512 PNGs and Ink/Paper previews; `apps/web/src/assets`: wordmark and symbol    |
| `desktop` | Tauri CLI, Python 3, librsvg `rsvg-convert` with `pdf1.4` support | `apps/web/src-tauri/icons`: rounded bundle icons, Paper icon and vector `menu-bar.pdf`                                      |
| `ios`     | Tauri CLI, macOS and Xcode with Swift/CoreGraphics/ImageIO        | `apps/ios/Resources/Assets.xcassets`: Ink/Paper app icons; `apps/ios/Sources/IndexUI/Resources`: previews and vector images |

Install librsvg with your platform's package manager (for example, `brew install
librsvg`). Put `rsvg-convert` on `PATH` or set `RSVG_CONVERT` to its executable.
The PDF is generated at its SVG viewBox dimensions, with a fixed creation date;
the native menu-bar image retains template rendering. Reproducible bytes require
the same renderer versions (librsvg 2.62.3 / Cairo 1.18.4 for the committed PDF).
Review regenerated outputs when upgrading renderers. ICNS element order is
normalized because Tauri otherwise emits the same encoded images in random order.

CI regenerates and checks web outputs. `bun test assets/brand/sync.test.ts` covers
stale/missing outputs and failure before publication. The desktop source check
uses the same nonmutating PDF conversion:
`python3 apps/web/scripts/check-menu-bar-source.py`.
Native regeneration and final appearance still need their platform tools; on a
Mac, run `bun assets/brand/sync.ts --check` and the iOS/native packaging checks.

## Platform behavior

The iOS icons remain opaque, square 1024px images; the OS supplies the corner
mask. `opaque-icon.swift` removes the alpha channel in staging without changing
canonical artwork. Shared SwiftUI previews use `Brand.xcassets`, while the Home
symbol and wordmark use vector `Assets.xcassets`. Desktop icons retain transparent
rounded corners. macOS ICNS and both runtime Dock PNGs use an 824px rounded tile
centered in a transparent 1024px canvas, with a 185.4px corner radius. `sync.ts`
applies this platform mask to the square artwork; it does not change the
canonical symbol or other platforms' geometry.

iOS Settings changes the actual Home Screen icon through the alternate-icon API.
macOS saves the choice on the device and reapplies it to the Dock at launch.
Finder and the downloaded bundle retain Ink. Other desktop platforms retain Ink
and do not show an unsupported icon picker.
