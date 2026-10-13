import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Tauri arranges its DMG window with Finder AppleScript and skips that whenever CI=true,
// leaving Finder's default window. dmgbuild (electron-builder's DMG backend) writes the
// layout and hides the toolbar, status bar and path bar without Finder.
const window = { width: 540, height: 280 };
const iconY = 130;
const archs: Record<string, string> = {
  "aarch64-apple-darwin": "aarch64",
  "x86_64-apple-darwin": "x64",
  "universal-apple-darwin": "universal",
};

const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
};

/** Removes the DMG from Tauri's bundles; Tauri still builds the app it packages. */
export function deferDmg(args: string[], platform = process.platform) {
  if (platform !== "darwin" || args.includes("--no-bundle")) return { args, dmg: false };
  const bundles: string[] = [];
  const rest: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--bundles" || arg === "-b") bundles.push(...(args[++index] ?? "").split(","));
    else if (arg.startsWith("--bundles=")) bundles.push(...arg.slice(10).split(","));
    else rest.push(arg);
  }
  // Without --bundles, Tauri's "all" targets on macOS are the app and DMG.
  const requested = bundles.length ? bundles : ["app", "dmg"];
  if (!requested.includes("dmg")) return { args, dmg: false };
  const tauri = new Set(["app", ...requested.filter((bundle) => bundle !== "dmg")]);
  return { args: [...rest, "--bundles", [...tauri].join(",")], dmg: true };
}

export function requireDmgbuild() {
  const command = process.env.DMGBUILD || "dmgbuild";
  if (spawnSync(command, ["--help"], { stdio: "ignore" }).status !== 0)
    throw new Error(
      "macOS DMGs require dmgbuild. Install scripts/desktop/dmgbuild-requirements.txt into a virtualenv and put dmgbuild on PATH or set DMGBUILD.",
    );
  return command;
}

/** dmgbuild's appdmg-format settings: window size matches the 1x background. */
export function dmgSettings(app: string, productName: string) {
  return {
    title: productName,
    icon: resolve("src-tauri/icons/icon.icns"),
    // dmgbuild combines background@2x.png from the same directory for Retina displays.
    background: resolve("src-tauri/dmg/background.png"),
    "icon-size": 80,
    window: { position: { x: 200, y: 200 }, size: window },
    contents: [
      { x: 140, y: iconY, type: "file", path: app, hide_extension: true },
      { x: window.width - 140, y: iconY, type: "link", path: "/Applications" },
    ],
  };
}

function buildTarget(args: string[]) {
  const index = args.findIndex((arg) => ["--target", "-t"].includes(arg));
  return index >= 0
    ? args[index + 1]
    : args.find((arg) => arg.startsWith("--target="))?.split("=")[1];
}

/** Where Tauri writes this build's bundles. */
export function bundleDir(args: string[]) {
  return join(
    resolve(process.env.CARGO_TARGET_DIR ?? "src-tauri/target"),
    buildTarget(args) ?? "",
    args.includes("--debug") ? "debug" : "release",
    "bundle",
  );
}

export function buildDmg(args: string[], productName: string, version: string) {
  const target = buildTarget(args);
  const arch = target ? archs[target] : process.arch === "arm64" ? "aarch64" : "x64";
  if (!arch) throw new Error("Unsupported DMG target.");
  const bundle = bundleDir(args);
  // Match Tauri's output so artifact collection finds exactly this version's image.
  const output = join(bundle, "dmg");
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const dmg = join(output, `${productName}_${version}_${arch}.dmg`);
  const temp = mkdtempSync(join(tmpdir(), "index-dmg-"));
  try {
    const settings = join(temp, "settings.json");
    writeFileSync(
      settings,
      JSON.stringify(dmgSettings(join(bundle, "macos", `${productName}.app`), productName)),
    );
    run(requireDmgbuild(), ["-s", settings, productName, dmg]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  // Tauri signed its DMG with the app's identity; ad hoc builds stay unsigned.
  const identity = process.env.APPLE_SIGNING_IDENTITY;
  if (identity && identity !== "-")
    run("codesign", ["--force", "--timestamp", "--sign", identity, dmg]);
  return dmg;
}
