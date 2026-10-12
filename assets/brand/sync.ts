// Generate only from the supplied artwork. Every selected output is staged before publishing.
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { orderedIcns } from "./icns.ts";

const brand = dirname(fileURLToPath(import.meta.url));
const root = resolve(brand, "../..");
const cli = join(root, "apps/web/node_modules/@tauri-apps/cli/tauri.js");
const ios = "apps/ios/Resources/Assets.xcassets";
const ui = "apps/ios/Sources/IndexUI/Resources";
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
if (targets.has("ios")) {
  if (process.platform !== "darwin")
    throw new Error(
      "The ios target requires macOS and Xcode. Use --target web or --target desktop on this platform.",
    );
  run("xcrun", ["--find", "swift"], { stdio: "pipe" });
  // Check the frameworks too, before rendering or modifying even a web output.
  run("xcrun", ["swift", join(brand, "opaque-icon.swift")], { stdio: "pipe" });
}
if (targets.has("desktop")) {
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
  for (const source of [
    "app-icon/app-store-1024.png",
    "app-icon/app-icon-square.svg",
    "wordmark/wordmark-white.svg",
    "symbol/symbol-white.svg",
  ])
    required.add(source);
}
if (targets.has("web") || targets.has("desktop")) required.add("app-icon/app-icon-rounded.svg");
if (targets.has("web")) required.add("app-icon/favicon.svg");
if (targets.has("desktop")) required.add("symbol/symbol-black.svg");
for (const source of required) readFileSync(join(brand, source));

const scratch = mkdtempSync(join(tmpdir(), "index-brand-"));
type Output = { source: string; size?: number; opaque: boolean };
const outputs = new Map<string, Output>();
const stage = (source: string, destination: string, size?: number, opaque = false) =>
  outputs.set(destination, { source, size, opaque });
const render = (source: string, name: string, sizes: number[] = []) => {
  const output = join(scratch, name);
  const args = [cli, "icon", source, "--output", output];
  for (const size of sizes) args.push("--png", String(size));
  run(process.execPath, args);
  return output;
};
const paper = (file: string) => {
  const path = join(scratch, `paper-${file}`);
  // Swap only the supplied palette. Geometry, placement and source files stay unchanged.
  writeFileSync(
    path,
    readFileSync(join(brand, "app-icon", file), "utf8").replace(/#0B0B0C|#FFFFFF/g, (color) =>
      color === "#0B0B0C" ? "#FFFFFF" : "#0B0B0C",
    ),
  );
  return path;
};
const catalog = (
  folder: string,
  filename: string,
  image: string,
  size: number,
  appIcon = false,
) => {
  stage(image, `${folder}/${filename}`, size, appIcon);
  const metadata = join(scratch, `${outputs.size}-Contents.json`);
  writeFileSync(
    metadata,
    JSON.stringify(
      {
        images: [
          {
            filename,
            idiom: "universal",
            ...(appIcon ? { platform: "ios", size: "1024x1024" } : {}),
          },
        ],
        info: { author: "xcode", version: 1 },
      },
      null,
      2,
    ) + "\n",
  );
  stage(metadata, `${folder}/Contents.json`);
};
function validate(path: string, { source, size, opaque }: Output) {
  const data = readFileSync(source);
  if (size) {
    if (
      !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      data.readUInt32BE(16) !== size ||
      data.readUInt32BE(20) !== size ||
      !data.subarray(-12).equals(Buffer.from("0000000049454e44ae426082", "hex")) ||
      (opaque && data[25] !== 2)
    )
      throw new Error(`Invalid ${size}px${opaque ? " opaque RGB" : ""} PNG: ${path}`);
  } else if (path.endsWith(".ico")) {
    if (data.readUInt32LE(0) !== 0x00010000 || data.readUInt16LE(4) === 0)
      throw new Error(`Invalid ICO: ${path}`);
  } else if (path.endsWith(".icns")) {
    if (data.toString("ascii", 0, 4) !== "icns" || data.readUInt32BE(4) !== data.length)
      throw new Error(`Invalid ICNS: ${path}`);
  } else if (!data.length) throw new Error(`Empty output: ${path}`);
}

try {
  // Paths are fixed before conditional rendering; consumers share the same target gates.
  const inkPreviews = join(scratch, "ink-previews"),
    paperPreviews = join(scratch, "paper-previews");
  if (targets.has("web") || targets.has("ios")) {
    render(
      join(brand, "app-icon/app-store-1024.png"),
      "ink-previews",
      targets.has("web") ? [192, 256, 512] : [256],
    );
    render(
      paper("app-icon-square.svg"),
      "paper-previews",
      targets.has("ios") ? [256, 1024] : [256],
    );
  }
  const rounded = join(scratch, "rounded");
  if (targets.has("web") || targets.has("desktop"))
    render(join(brand, "app-icon/app-icon-rounded.svg"), "rounded");
  if (targets.has("web")) {
    stage(join(inkPreviews, "256x256.png"), `${web}/app-icon.png`, 256);
    for (const size of [192, 512])
      stage(join(inkPreviews, `${size}x${size}.png`), `${web}/app-icon-${size}.png`, size);
    for (const [style, folder] of [
      ["ink", inkPreviews],
      ["paper", paperPreviews],
    ] as const)
      stage(join(folder, "256x256.png"), `${web}/app-icons/${style}.png`, 256);
    stage(join(rounded, "icon.ico"), `${web}/favicon.ico`);
    stage(join(brand, "app-icon/favicon.svg"), `${web}/favicon.svg`);
    stage(join(brand, "wordmark/wordmark-white.svg"), "apps/web/src/assets/wordmark.svg");
    stage(join(brand, "symbol/symbol-white.svg"), "apps/web/src/assets/brand-symbol.svg");
  }
  if (targets.has("desktop")) {
    const icns = join(rounded, "icon.icns");
    writeFileSync(icns, orderedIcns(readFileSync(icns)));
    const sizes: Record<string, number> = {
      "32x32.png": 32,
      "64x64.png": 64,
      "128x128.png": 128,
      "128x128@2x.png": 256,
      "icon.png": 512,
      "StoreLogo.png": 50,
    };
    for (const size of [30, 44, 71, 89, 107, 142, 150, 284, 310])
      sizes[`Square${size}x${size}Logo.png`] = size;
    for (const [file, size] of Object.entries(sizes))
      stage(join(rounded, file), `${desktop}/${file}`, size);
    for (const file of ["icon.icns", "icon.ico"]) stage(join(rounded, file), `${desktop}/${file}`);
    const alternate = render(paper("app-icon-rounded.svg"), "paper-desktop", [512]);
    stage(join(alternate, "512x512.png"), `${desktop}/icon-paper.png`, 512);
    const menu = join(scratch, "menu-bar.pdf");
    run("python3", [join(root, "apps/web/scripts/menu-bar-icon.py"), "--output", menu]);
    stage(menu, `${desktop}/menu-bar.pdf`);
  }
  if (targets.has("ios")) {
    const ink = join(scratch, "ink-opaque.png"),
      alternate = join(scratch, "paper-opaque.png");
    copyFileSync(join(brand, "app-icon/app-store-1024.png"), ink);
    copyFileSync(join(paperPreviews, "1024x1024.png"), alternate);
    run("xcrun", ["swift", join(brand, "opaque-icon.swift"), ink, alternate]);
    catalog(`${ios}/AppIcon.appiconset`, "Icon.png", ink, 1024, true);
    catalog(`${ios}/AppIconPaper.appiconset`, "Icon.png", alternate, 1024, true);
    catalog(
      `${ui}/Brand.xcassets/AppIconInk.imageset`,
      "Image.png",
      join(inkPreviews, "256x256.png"),
      256,
    );
    catalog(
      `${ui}/Brand.xcassets/AppIconPaper.imageset`,
      "Image.png",
      join(paperPreviews, "256x256.png"),
      256,
    );
    stage(
      join(brand, "wordmark/wordmark-white.svg"),
      `${ui}/Assets.xcassets/IndexWordmark.imageset/wordmark.svg`,
    );
    stage(
      join(brand, "symbol/symbol-white.svg"),
      `${ui}/Assets.xcassets/NavFeed.imageset/icon.svg`,
    );
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
