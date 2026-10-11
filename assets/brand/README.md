The original files in `symbol`, `wordmark`, `lockup`, and `app-icon` come unchanged
from `index-geist-original-hop-square-ink.zip`. See `README.txt` from that pack.

Run `bun assets/brand/sync.mjs` from the repository root to refresh the iOS asset
catalogs, shared SwiftUI artwork, desktop bundle icons, web favicon and icon
previews. Run it on a Mac with Xcode and the locally installed Tauri CLI; no separate image tool is needed.
Generated assets are committed so normal builds do not need this step.
The SwiftUI icon previews live in the shared package's `Brand.xcassets`; the
wordmark and Home symbol use its existing vector `Assets.xcassets`. Both catalogs
support named-image lookup in the built app and preview.

Ink is the supplied default. Paper swaps the pack's two colors, retaining its exact
paths, scale and placement. iOS uses opaque, square 1024 px images; the OS supplies
the corner mask. `opaque-icon.swift` removes alpha channels from both iOS icons for
App Store compatibility, leaving the supplied source files untouched. Desktop uses
the supplied rounded artwork with transparent corners.

In Settings, iOS changes the actual Home Screen icon through its alternate-icon
API. macOS saves the choice on the device and reapplies it to the Dock at launch.
Finder and the downloaded bundle retain the default Ink icon; changing them would
require modifying the installed application. Other desktop platforms retain Ink
and do not show an unsupported icon picker.
