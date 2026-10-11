// Keep the supplied artwork as the source of truth. Requires the installed Tauri CLI.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const brand = dirname(fileURLToPath(import.meta.url));
const root = resolve(brand, "../..");
const scratch = mkdtempSync(join(tmpdir(), "index-brand-"));
const cli = join(root, "apps/web/node_modules/.bin/tauri");
const ios = join(root, "apps/ios/Resources/Assets.xcassets");
const ui = join(root, "apps/ios/Sources/IndexUI/Resources");
const desktop = join(root, "apps/web/src-tauri/icons");
const web = join(root, "apps/web/public");
const copy = (from, to) => {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
};
const render = (source, output, sizes = []) => {
  const args = ["icon", source, "--output", output];
  for (const size of sizes) args.push("--png", String(size));
  const result = spawnSync(cli, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Could not render Index icons.");
};
const paper = (source, output) => {
  // Swap only the two supplied palette colors; all original paths and spacing stay intact.
  writeFileSync(
    output,
    readFileSync(source, "utf8").replace(/#0B0B0C|#FFFFFF/g, (color) =>
      color === "#0B0B0C" ? "#FFFFFF" : "#0B0B0C",
    ),
  );
};
const catalog = (name, source) => {
  const folder = join(ios, name + ".appiconset");
  copy(source, join(folder, "Icon.png"));
  writeFileSync(
    join(folder, "Contents.json"),
    JSON.stringify(
      {
        images: [{ filename: "Icon.png", idiom: "universal", platform: "ios", size: "1024x1024" }],
        info: { author: "xcode", version: 1 },
      },
      null,
      2,
    ) + "\n",
  );
};
const imageSet = (name, source) => {
  const folder = join(ui, "Brand.xcassets", name + ".imageset");
  copy(source, join(folder, "Image.png"));
  writeFileSync(
    join(folder, "Contents.json"),
    JSON.stringify(
      {
        images: [{ filename: "Image.png", idiom: "universal" }],
        info: { author: "xcode", version: 1 },
      },
      null,
      2,
    ) + "\n",
  );
  // These were previously loose PNGs; SwiftUI's named lookup requires catalog entries.
  rmSync(join(ui, name + ".png"), { force: true });
};

try {
  const squarePaper = join(scratch, "paper-square.svg");
  const roundedPaper = join(scratch, "paper-rounded.svg");
  paper(join(brand, "app-icon/app-icon-square.svg"), squarePaper);
  paper(join(brand, "app-icon/app-icon-rounded.svg"), roundedPaper);
  render(squarePaper, join(scratch, "paper-ios"), [1024, 256]);
  render(join(brand, "app-icon/app-store-1024.png"), join(scratch, "ink-ios"), [256]);
  render(join(brand, "app-icon/app-icon-rounded.svg"), join(scratch, "ink-desktop"));
  render(roundedPaper, join(scratch, "paper-desktop"), [512]);

  catalog("AppIcon", join(brand, "app-icon/app-store-1024.png"));
  catalog("AppIconPaper", join(scratch, "paper-ios/1024x1024.png"));
  const opaque = spawnSync(
    "xcrun",
    [
      "swift",
      join(brand, "opaque-icon.swift"),
      join(ios, "AppIcon.appiconset/Icon.png"),
      join(ios, "AppIconPaper.appiconset/Icon.png"),
    ],
    { stdio: "inherit" },
  );
  if (opaque.error) throw opaque.error;
  if (opaque.status !== 0) throw new Error("Could not remove iOS app icon alpha channels.");
  copy(
    join(brand, "wordmark/wordmark-white.svg"),
    join(ui, "Assets.xcassets/IndexWordmark.imageset/wordmark.svg"),
  );
  copy(
    join(brand, "symbol/symbol-white.svg"),
    join(ui, "Assets.xcassets/NavFeed.imageset/icon.svg"),
  );
  for (const style of ["ink", "paper"]) {
    const preview = join(scratch, style + "-ios/256x256.png");
    imageSet(style === "ink" ? "AppIconInk" : "AppIconPaper", preview);
    copy(preview, join(web, "app-icons", style + ".png"));
  }
  // The existing Tauri bundle's full set, including Windows tiles and multi-size ICNS/ICO.
  for (const file of [
    "32x32.png",
    "64x64.png",
    "128x128.png",
    "128x128@2x.png",
    "icon.png",
    "icon.icns",
    "icon.ico",
    "Square30x30Logo.png",
    "Square44x44Logo.png",
    "Square71x71Logo.png",
    "Square89x89Logo.png",
    "Square107x107Logo.png",
    "Square142x142Logo.png",
    "Square150x150Logo.png",
    "Square284x284Logo.png",
    "Square310x310Logo.png",
    "StoreLogo.png",
  ]) {
    copy(join(scratch, "ink-desktop", file), join(desktop, file));
  }
  copy(join(scratch, "paper-desktop/512x512.png"), join(desktop, "icon-paper.png"));
  copy(join(scratch, "ink-ios/256x256.png"), join(web, "app-icon.png"));
  copy(join(scratch, "ink-desktop/icon.ico"), join(web, "favicon.ico"));
  copy(join(brand, "wordmark/wordmark-white.svg"), join(root, "apps/web/src/assets/wordmark.svg"));
  copy(join(brand, "symbol/symbol-white.svg"), join(root, "apps/web/src/assets/brand-symbol.svg"));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
