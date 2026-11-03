# Brand artwork

This folder is the canonical artwork source shared by web, desktop and iOS; it is
not a package. The supplied logo SVG and PNG files come unchanged from
`index-geist-original-hop-square-ink.zip` (Geist, Original icon, hop square, Ink).
The wordmark is outlined Geist 600 and needs no installed font; consult the
original typeface licence before reusing it outside this project.

Ink uses background `#0B0B0C` and symbol `#FFFFFF`. The Apple app icon pairs it with
Paper, a light treatment of the same mark (see [Icon Composer icon](#icon-composer-icon)).

| Source                          | Use                                                                     |
| ------------------------------- | ----------------------------------------------------------------------- |
| `symbol/symbol-white.svg`       | Web Home symbol and shared SwiftUI template image                       |
| `symbol/symbol-black.svg`       | Desktop menu-bar vector PDF                                             |
| `wordmark/wordmark-white.svg`   | Web and shared SwiftUI wordmark                                         |
| `app-icon/app-icon.icon`        | Icon Composer source: iOS app icon, macOS bundle icon and static ICNS   |
| `app-icon/app-store-1024.png`   | Opaque Apple touch icon and maskable web icons                          |
| `app-icon/app-icon-square.svg`  | Geometry the Icon Composer layers must match exactly (checked by tests) |
| `app-icon/app-icon-rounded.svg` | Inset Windows/Linux/web launcher icons and web ICO fallback             |
| `app-icon/favicon.svg`          | Explicit web SVG favicon                                                |

The other wordmarks, symbols, lockups, PNG sizes and rounded exports remain useful
brand resources. They are retained even when no current application imports them.

## Icon Composer icon

`app-icon.icon` is an Icon Composer document: `icon.json` plus layer SVGs. Open it in
Xcode's Icon Composer, or edit `icon.json` by hand. Each layer SVG is a full 1024px
canvas holding one part of the mark at its brand position, so the stem and the dot sit
in separate groups and receive their own Liquid Glass depth, specular highlight and
shadow. Change only the treatment; the paths must stay those of `app-icon-square.svg`.

| Appearance    | Look                                                                         |
| ------------- | ---------------------------------------------------------------------------- |
| Default       | Paper: white to light grey, opaque Ink mark fading to graphite               |
| Dark          | Ink: gradient lighter at the top, white glass mark at 40% translucency       |
| Clear, Tinted | White glass mark at 40% translucency; the system supplies the glass and tint |

The palette stays black and white. Both groups have specular highlights and a neutral
shadow at 50%. The operating system picks the appearance, not the app, and it follows
the icon style setting rather than light or dark mode alone:

- macOS 26 and later: System Settings → Appearance → Icon & widget style. Default
  shows Paper in light and dark mode. Dark shows Ink Always, or with Auto only while
  the system appearance is dark, which gives Paper in light mode and Ink in dark mode.
  Clear has its own Light, Dark and Auto variants; Tinted colors the mark.
- iOS and iPadOS 26 and later: Home Screen → Edit → Customize offers the same styles.
  With the factory setting the icon stays Paper in dark mode.

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

| Target    | Prerequisites                                                                  | Generated destinations                                                                               |
| --------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `web`     | Repository's locked Tauri CLI                                                  | `apps/web/public`: SVG/ICO favicons and 192/256/512 PNGs; `apps/web/src/assets`: wordmark and symbol |
| `desktop` | Tauri CLI, macOS, Xcode 26+ (Icon Composer, Swift), Python 3, librsvg `pdf1.4` | `apps/web/src-tauri/icons`: `icon.icon`, ICNS, rounded bundle icons and vector `menu-bar.pdf`        |
| `ios`     | Repository's locked Tauri CLI                                                  | `apps/ios/Resources`: `AppIcon.icon`; `apps/ios/Sources/IndexUI/Resources`: vector images            |

Install librsvg with your platform's package manager (for example, `brew install
librsvg`). Put `rsvg-convert` on `PATH` or set `RSVG_CONVERT` to its executable.
The PDF is generated at its SVG viewBox dimensions, with a fixed creation date;
the native menu-bar image retains template rendering. Reproducible bytes require
the same renderer versions (librsvg 2.62.3 / Cairo 1.18.4 for the committed PDF;
Icon Composer 27.0 `ictool`, from the selected Xcode, for the ICNS). Review
regenerated outputs when upgrading renderers. ICNS element order is normalized
because Tauri otherwise emits the same encoded images in random order.

CI regenerates and checks web outputs. `bun test assets/brand` checks generated
PNG pixels, every PNG frame inside ICO/ICNS, packaging paths, maskable safe zones,
the opaque touch icon, the Icon Composer layer geometry and shipped copies,
stale/missing outputs and failure before publication. The desktop source check
uses the same nonmutating PDF conversion:
`python3 apps/web/scripts/check-menu-bar-source.py`.
Native regeneration and final appearance still need their platform tools; on a
Mac, run `bun assets/brand/sync.ts --check` and the iOS/native packaging checks.

## Platform behavior

`sync.ts` composes the canonical artwork into destination-specific canvases.
Padding is part of the exported pixels, so changing display resolution or
relaunching the app does not change the icon's relative size.

| Destination    | Canvas and visible bounds                                               | Consumer                                      |
| -------------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| macOS          | Icon Composer document; ICNS: its 824px Default tile centered in 1024px | `Assets.car` on macOS 26+; `icon.icns` before |
| Windows        | 42px tile centered in 48px                                              | All six frames of `icon.ico`; NSIS/Win32      |
| Linux          | 104px tile centered in 128px                                            | Bundled 32/48/64/128/256/512 PNGs             |
| Web `any`      | Same inset silhouette as Linux                                          | Launchers that display the exported shape     |
| Web `maskable` | Opaque square, entire symbol inside the central 40%-radius circle       | Launchers that supply their own mask          |
| iOS            | Icon Composer document; Xcode renders every appearance                  | Home Screen, including iOS 17-25 fallback     |
| Apple touch    | Opaque square, no baked-in corners or outer padding                     | System-masked web clips                       |

macOS bundles carry both forms. Tauri compiles `icons/icon.icon` into `Assets.car`
and sets `CFBundleIconName` when its `actool` is from Xcode 26 or later; with an
older Xcode it logs that it skipped the car. The ICNS, rendered by `ictool` from the
document's Default (Paper) appearance and shape, stays `CFBundleIconFile`: macOS
14-15 and bundles without the car show it whatever the icon style. The release
workflow currently selects Xcode 16.4, so released DMGs carry only the ICNS until it
selects Xcode 26 or later.

Windows spacing follows the square keyline in [Microsoft's icon grid](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-design).
Linux uses the square guide in the [GNOME template](https://gitlab.gnome.org/Teams/Design/HIG-app-icons/-/blob/master/template.svg);
desktop environments and icon themes can apply their own presentation. Windows
and Linux retain the brand's rounded silhouette rather than applying a Mac mask.
Reserved `Square*Logo.png`/`StoreLogo.png` exports are unchanged; the release does
not ship MSIX/AppX tiles.

The web manifest deliberately uses separate files for `any` and `maskable`.
The [Web App Manifest safe-zone contract](https://www.w3.org/TR/appmanifest/#icon-masks)
requires essential content to fit within the central circle. Favicons stay
compact, without launcher padding. `icon-png.swift` turns `ictool`'s 16-bit export
into an 8-bit PNG on the ICNS canvas. The shared SwiftUI Home symbol and wordmark
use vector `Assets.xcassets`.

Windows, Linux and the web keep Ink and offer no icon choice.
