// Generate only from the supplied artwork. Every selected output is staged before publishing.
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { orderedIcns } from "./icns.ts";

const brand = dirname(fileURLToPath(import.meta.url));
const root = resolve(brand, "../..");
const cli = join(root, "apps/web/node_modules/@tauri-apps/cli/tauri.js");
const ios = "apps/ios/Resources";
const ui = "apps/ios/Sources/IndexUI/Resources";
const actionIcon = "apps/ios/ShareExtension/Action.xcassets/AppIcon.appiconset";
const desktop = "apps/web/src-tauri/icons";
const web = "apps/web/public";
const { values } = parseArgs({
  options: {
    target: { type: "string", multiple: true },
    check: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
if (values.help) {
  console.log(
    "Usage: bun assets/brand/sync.ts [--target web|desktop|ios]... [--check]\nDefault: all targets. --check regenerates into temporary staging and never changes outputs.",
  );
  process.exit(0);
}
const targets = new Set(values.target ?? ["web", "desktop", "ios"]);
for (const target of targets) {
  if (!["web", "desktop", "ios"].includes(target))
    throw new Error(`Unknown brand target: ${target}`);
}
const run = (
  command: string,
  args: string[],
  options: Omit<SpawnSyncOptionsWithStringEncoding, "encoding"> = {},
) => {
  const result = spawnSync(command, args, { stdio: "inherit", encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
  return result;
};

// Check every prerequisite before any generation or output changes, including all-target runs.
if (!existsSync(cli))
  throw new Error("Install the repository's locked dependencies before generating brand assets.");
run(process.execPath, [cli, "--version"], { stdio: "pipe" });
let ictool = "";
if (targets.has("desktop")) {
  // Only Icon Composer applies the layered icon's glass, shadows and macOS shape.
  if (process.platform !== "darwin")
    throw new Error(
      "The desktop target requires macOS and Xcode 26 or later. Use --target web or --target ios on this platform.",
    );
  const developer = run("xcode-select", ["-p"], { stdio: "pipe" }).stdout.trim();
  ictool = join(developer, "../Applications/Icon Composer.app/Contents/Executables/ictool");
  try {
    run(ictool, ["--version"], { stdio: "pipe" });
  } catch {
    throw new Error("Select Xcode 26 or later, which includes Icon Composer's ictool.");
  }
  // Check the frameworks too, before rendering or modifying even a web output.
  run("xcrun", ["swift", join(brand, "icon-png.swift")], { stdio: "pipe" });
  run("python3", ["--version"], { stdio: "pipe" });
  const converter = process.env.RSVG_CONVERT || "rsvg-convert";
  let help;
  try {
    help = run(converter, ["--help"], { stdio: "pipe" }).stdout;
  } catch {
    throw new Error(
      "Desktop generation requires librsvg's rsvg-convert. Install librsvg or set RSVG_CONVERT to its executable.",
    );
  }
  if (!help.includes("pdf1.4"))
    throw new Error("Update librsvg: rsvg-convert must support --format pdf1.4.");
}
const required = new Set<string>();
if (targets.has("web") || targets.has("ios")) {
  required.add("wordmark/wordmark-white.svg");
  required.add("symbol/symbol-white.svg");
}
if (targets.has("web") || targets.has("desktop")) required.add("app-icon/app-icon-rounded.svg");
if (targets.has("web")) {
  required.add("app-icon/app-store-1024.png");
  required.add("app-icon/favicon.svg");
}
if (targets.has("desktop")) required.add("symbol/symbol-black.svg");
for (const source of required) readFileSync(join(brand, source));
const bundle = join(brand, "app-icon/app-icon.icon");
if (targets.has("ios") || targets.has("desktop")) {
  // The iOS target only copies the document, and Xcode rejects one whose layers name missing
  // artwork, so the layers are checked here rather than when the app is built.
  const { groups } = JSON.parse(readFileSync(join(bundle, "icon.json"), "utf8")) as {
    groups?: { layers?: { "image-name"?: string }[] }[];
  };
  const layers = groups?.flatMap((group) => group.layers ?? []) ?? [];
  if (!layers.length) throw new Error("app-icon.icon has no layers.");
  for (const layer of layers) {
    const image = layer["image-name"];
    if (!image || !existsSync(join(bundle, "Assets", image)))
      throw new Error(`app-icon.icon names missing artwork: ${image ?? "(none)"}`);
  }
}

const scratch = mkdtempSync(join(tmpdir(), "index-brand-"));
type Output = { source: string; size?: number };
const outputs = new Map<string, Output>();
const stage = (source: string, destination: string, size?: number) =>
  outputs.set(destination, { source, size });
// An Icon Composer document is a bundle: icon.json plus the layer artwork it names.
const stageIcon = (destination: string) => {
  for (const file of readdirSync(bundle, { recursive: true, encoding: "utf8" }).toSorted()) {
    if (basename(file).startsWith(".") || statSync(join(bundle, file)).isDirectory()) continue;
    stage(join(bundle, file), `${destination}/${file}`);
  }
};
const render = (source: string, name: string, sizes: number[] = []) => {
  const output = join(scratch, name);
  const args = [cli, "icon", source, "--output", output];
  for (const size of sizes) args.push("--png", String(size));
  run(process.execPath, args);
  return output;
};
const iconCanvas = (
  source: string,
  name: string,
  platform: "windows" | "linux" | "web" | "ios-action",
) => {
  const path = join(scratch, `${name}.svg`);
  // Optical bounds belong to the destination, not to the shared brand artwork.
  // Windows: square keyline on a 48px grid. Linux: 104px square on GNOME's 128px grid.
  // iOS share sheet actions: the solid symbol stands a little shorter than the outlined system glyphs beside it.
  const { canvas, inset } = {
    windows: { canvas: 48, inset: 3 },
    linux: { canvas: 128, inset: 12 },
    web: { canvas: 128, inset: 12 },
    "ios-action": { canvas: 128, inset: 22 },
  }[platform];
  const size = canvas - 2 * inset;
  const artwork = readFileSync(source).toString("base64");
  writeFileSync(
    path,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${canvas}" width="${canvas}" height="${canvas}">
      <image x="${inset}" y="${inset}" width="${size}" height="${size}" href="data:image/svg+xml;base64,${artwork}"/>
    </svg>`,
  );
  return path;
};
function validate(path: string, { source, size }: Output) {
  const data = readFileSync(source);
  if (size) {
    if (
      !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      data.readUInt32BE(16) !== size ||
      data.readUInt32BE(20) !== size ||
      !data.subarray(-12).equals(Buffer.from("0000000049454e44ae426082", "hex"))
    )
      throw new Error(`Invalid ${size}px PNG: ${path}`);
  } else if (path.endsWith(".ico")) {
    if (data.readUInt32LE(0) !== 0x00010000 || data.readUInt16LE(4) === 0)
      throw new Error(`Invalid ICO: ${path}`);
  } else if (path.endsWith(".icns")) {
    if (data.toString("ascii", 0, 4) !== "icns" || data.readUInt32BE(4) !== data.length)
      throw new Error(`Invalid ICNS: ${path}`);
  } else if (!data.length) throw new Error(`Empty output: ${path}`);
}

try {
  const rounded = join(scratch, "rounded");
  if (targets.has("web") || targets.has("desktop"))
    render(join(brand, "app-icon/app-icon-rounded.svg"), "rounded");
  if (targets.has("web")) {
    // Unmasked launchers receive an inset silhouette; adaptive launchers own their mask.
    const launchers = render(
      iconCanvas(join(brand, "app-icon/app-icon-rounded.svg"), "web-launcher", "web"),
      "web-launchers",
      [192, 512],
    );
    const opaque = render(join(brand, "app-icon/app-store-1024.png"), "opaque", [192, 256, 512]);
    stage(join(opaque, "256x256.png"), `${web}/app-icon.png`, 256);
    for (const size of [192, 512]) {
      stage(join(launchers, `${size}x${size}.png`), `${web}/app-icon-${size}.png`, size);
      stage(join(opaque, `${size}x${size}.png`), `${web}/app-icon-maskable-${size}.png`, size);
    }
    stage(join(rounded, "icon.ico"), `${web}/favicon.ico`);
    stage(join(brand, "app-icon/favicon.svg"), `${web}/favicon.svg`);
    stage(join(brand, "wordmark/wordmark-white.svg"), "apps/web/src/assets/wordmark.svg");
    stage(join(brand, "symbol/symbol-white.svg"), "apps/web/src/assets/brand-symbol.svg");
  }
  if (targets.has("desktop")) {
    // The static ICNS shows the Default (light) appearance on Icon Composer's 824px macOS tile,
    // centered in 1024px. ictool takes points; scale 1 makes them pixels.
    const exported = join(scratch, "macos-export.png"),
      tile = join(scratch, "macos-tile.png");
    run(
      ictool,
      [
        bundle,
        "--export-image",
        "--output-file",
        exported,
        "--platform",
        "macOS",
        "--rendition",
        "Default",
        "--width",
        "824",
        "--height",
        "824",
        "--scale",
        "1",
      ],
      { stdio: "pipe" },
    );
    run("xcrun", ["swift", join(brand, "icon-png.swift"), exported, tile, "1024"]);
    const macos = render(tile, "macos-desktop");
    const windows = render(
      iconCanvas(join(brand, "app-icon/app-icon-rounded.svg"), "windows-icon", "windows"),
      "windows-desktop",
    );
    const linux = render(
      iconCanvas(join(brand, "app-icon/app-icon-rounded.svg"), "linux-icon", "linux"),
      "linux-desktop",
      [32, 48, 64, 128, 256, 512],
    );
    const icns = join(macos, "icon.icns");
    writeFileSync(icns, orderedIcns(readFileSync(icns)));
    const sizes: Record<string, number> = {
      "StoreLogo.png": 50,
    };
    for (const size of [30, 44, 71, 89, 107, 142, 150, 284, 310])
      sizes[`Square${size}x${size}Logo.png`] = size;
    for (const [file, size] of Object.entries(sizes))
      stage(join(rounded, file), `${desktop}/${file}`, size);
    for (const size of [32, 48, 64, 128, 256, 512]) {
      const name =
        size === 512 ? "icon.png" : size === 256 ? "128x128@2x.png" : `${size}x${size}.png`;
      stage(join(linux, `${size}x${size}.png`), `${desktop}/${name}`, size);
    }
    // Tauri compiles the layered document into Assets.car with Xcode 26+; the ICNS is the
    // fallback for macOS before 26 and for builds with an older Xcode.
    stage(icns, `${desktop}/icon.icns`);
    stageIcon(`${desktop}/icon.icon`);
    stage(join(windows, "icon.ico"), `${desktop}/icon.ico`);
    const menu = join(scratch, "menu-bar.pdf");
    run("python3", [join(root, "apps/web/scripts/menu-bar-icon.py"), "--output", menu]);
    stage(menu, `${desktop}/menu-bar.pdf`);
  }
  if (targets.has("ios")) {
    // Xcode compiles the document into Assets.car, with flattened images for iOS before 26.
    stageIcon(`${ios}/AppIcon.icon`);
    stage(
      join(brand, "wordmark/wordmark-white.svg"),
      `${ui}/Assets.xcassets/IndexWordmark.imageset/wordmark.svg`,
    );
    stage(
      join(brand, "symbol/symbol-white.svg"),
      `${ui}/Assets.xcassets/NavFeed.imageset/icon.svg`,
    );
    // The share sheet draws an Action extension's icon from its alpha channel alone.
    const action = render(
      iconCanvas(join(brand, "symbol/symbol-white.svg"), "ios-action", "ios-action"),
      "ios-action",
      [1024],
    );
    stage(join(action, "1024x1024.png"), `${actionIcon}/icon.png`, 1024);
  }
  for (const [path, output] of outputs) validate(path, output);
  if (values.check) {
    const stale = [...outputs]
      .filter(
        ([path, { source }]) =>
          !existsSync(join(root, path)) ||
          !readFileSync(source).equals(readFileSync(join(root, path))),
      )
      .map(([path]) => path);
    if (stale.length)
      throw new Error(
        `Missing or stale brand outputs:\n${stale.join("\n")}\nRegenerate the selected targets without --check.`,
      );
    console.log(`Brand outputs match (${[...targets].join(", ")}; ${outputs.size} files).`);
  } else {
    for (const [path, { source }] of outputs) {
      const destination = join(root, path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
    console.log(`Updated brand outputs (${[...targets].join(", ")}; ${outputs.size} files).`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
