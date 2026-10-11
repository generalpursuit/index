import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Cargo passes the just-built executable and its arguments. Tauri still owns
// compilation, the watcher, and this PID throughout rebuilds and shutdown.
const [executable, ...args] = process.argv.slice(2);
if (process.platform !== "darwin" || !executable || !process.env.TAURI_CONFIG) {
  throw new Error("Use this macOS runner through bun run desktop:dev.");
}
const tauri = fileURLToPath(new URL("../src-tauri/", import.meta.url));
const base = JSON.parse(readFileSync(join(tauri, "tauri.conf.json"), "utf8"));
const overrides = JSON.parse(process.env.TAURI_CONFIG);
const config = { ...base, ...overrides };
const binary = resolve(executable);
const name = config.productName;
const bundle = join(dirname(binary), "bundle", "dev", `${name}.app`);
const contents = join(bundle, "Contents");
const bundledBinary = join(contents, "MacOS", basename(binary));
mkdirSync(join(contents, "MacOS"), { recursive: true });
mkdirSync(join(contents, "Resources"), { recursive: true });
copyFileSync(binary, bundledBinary);
copyFileSync(join(tauri, "icons/icon.icns"), join(contents, "Resources/icon.icns"));

function run(command, commandArgs, input) {
  const result = spawnSync(command, commandArgs, { input, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
}

run(
  "plutil",
  ["-convert", "xml1", "-o", join(contents, "Info.plist"), "-"],
  JSON.stringify({
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundlePackageType: "APPL",
    CFBundleExecutable: basename(binary),
    CFBundleIdentifier: config.identifier,
    CFBundleName: name,
    CFBundleDisplayName: name,
    CFBundleShortVersionString: config.version,
    CFBundleVersion: config.version,
    CFBundleIconFile: "icon.icns",
    NSHighResolutionCapable: true,
    NSPrincipalClass: "NSApplication",
  }),
);
run("codesign", ["--force", "--sign", "-", bundle]);

// Do not use `open` or spawn a detached child: Tauri must stop the real app
// before rebuilding. execve also preserves arguments, environment and stdio.
process.execve(bundledBinary, [bundledBinary, ...args], process.env);
