import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
};
const xml = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const plist = (dict) =>
  `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>${Object.entries(
    dict,
  )
    .map(
      ([key, value]) =>
        `<key>${xml(key)}</key>${Array.isArray(value) ? `<array>${value.map((item) => `<string>${xml(item)}</string>`).join("")}</array>` : `<string>${xml(value)}</string>`}`,
    )
    .join("")}</dict></plist>`;

/** Build the actual appex before Tauri copies/signs the containing bundle. No local credentials. */
export function prepareShareExtension({
  local,
  args,
  configurationFile = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")),
}) {
  const team = process.env.INDEX_APPLE_TEAM_ID;
  const group = process.env.INDEX_KEYCHAIN_GROUP;
  const identity = process.env.APPLE_SIGNING_IDENTITY;
  const web = process.env.INDEX_WEB_URL;
  const hostProfile = process.env.INDEX_MAC_HOST_PROFILE;
  if (
    !team ||
    !/^[A-Z0-9]{10}$/.test(team) ||
    !group ||
    !/^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/.test(group) ||
    !identity ||
    !web
  )
    throw new Error(
      "Sharing builds require INDEX_APPLE_TEAM_ID, INDEX_KEYCHAIN_GROUP (with your App ID prefix), APPLE_SIGNING_IDENTITY and INDEX_WEB_URL. See docs/sharing.md. Smoke builds stay separate.",
    );
  if (!hostProfile || !existsSync(hostProfile))
    throw new Error(
      "Set INDEX_MAC_HOST_PROFILE to the provisioning profile authorizing this host's shared Keychain group. The build embeds it before signing.",
    );
  const webURL = new URL(web);
  if (
    webURL.username ||
    webURL.password ||
    webURL.search ||
    webURL.hash ||
    (webURL.protocol !== "https:" &&
      !(
        local &&
        webURL.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(webURL.hostname)
      ))
  )
    throw new Error("INDEX_WEB_URL must be a valid HTTPS origin (loopback HTTP with --local).");
  const targetIndex = args.findIndex((arg) => ["--target", "-t"].includes(arg));
  const target =
    targetIndex >= 0
      ? args[targetIndex + 1]
      : args.find((arg) => arg.startsWith("--target="))?.split("=")[1];
  if (
    target &&
    !["aarch64-apple-darwin", "x86_64-apple-darwin", "universal-apple-darwin"].includes(target)
  )
    throw new Error("Unsupported sharing target.");
  const archs =
    target === "universal-apple-darwin"
      ? "arm64 x86_64"
      : target === "x86_64-apple-darwin"
        ? "x86_64"
        : target === "aarch64-apple-darwin"
          ? "arm64"
          : process.arch === "arm64"
            ? "arm64"
            : "x86_64";
  const root = resolve("../ios"),
    output = resolve("src-tauri/target/share-extension");
  mkdirSync(output, { recursive: true });
  const release = !args.includes("--debug"),
    configuration = release ? "Release" : "Debug";
  run("xcodebuild", [
    "-project",
    join(root, "Index.xcodeproj"),
    "-scheme",
    "IndexShareMac",
    "-configuration",
    configuration,
    "-destination",
    "generic/platform=macOS",
    "-derivedDataPath",
    join(output, "DerivedData"),
    `ARCHS=${archs}`,
    "ONLY_ACTIVE_ARCH=NO",
    `DEVELOPMENT_TEAM=${team}`,
    `CODE_SIGN_IDENTITY=${identity}`,
    // Only IndexShareMac maps these custom settings to its bundle ID and profile.
    // Global overrides also reach Swift package resource bundles, which cannot be provisioned.
    `INDEX_SHARE_EXTENSION_ID=${process.env.INDEX_SHARE_EXTENSION_ID || `${configurationFile.identifier}.share-mac`}`,
    `INDEX_SHARE_DISPLAY_NAME=${process.env.INDEX_SHARE_DISPLAY_NAME || configurationFile.productName}`,
    ...(process.env.INDEX_MAC_EXTENSION_PROFILE_SPECIFIER
      ? [
          "INDEX_MAC_CODE_SIGN_STYLE=Manual",
          `INDEX_MAC_EXTENSION_PROFILE_SPECIFIER=${process.env.INDEX_MAC_EXTENSION_PROFILE_SPECIFIER}`,
        ]
      : ["INDEX_MAC_CODE_SIGN_STYLE=Automatic"]),
    "ENABLE_HARDENED_RUNTIME=YES",
    `INDEX_API_URL=${process.env.VITE_SERVER_URL}`,
    `INDEX_WEB_URL=${web}`,
    `MARKETING_VERSION=${configurationFile.version}`,
    `CURRENT_PROJECT_VERSION=${configurationFile.bundle?.macOS?.bundleVersion ?? configurationFile.version}`,
    `INDEX_KEYCHAIN_GROUP=${group}`,
    "build",
  ]);
  const extension = join(
    output,
    "DerivedData/Build/Products",
    configuration,
    "IndexShareMac.appex",
  );
  run("codesign", ["--verify", "--strict", extension]);
  const info = join(output, "Host-Info.plist"),
    entitlements = join(output, "Host.entitlements");
  writeFileSync(
    info,
    plist({
      IndexKeychainGroup: group,
      IndexAPIURL: process.env.VITE_SERVER_URL,
      IndexWebURL: web,
    }),
  );
  // The Tauri host already owns network access outside App Sandbox. Both signed targets
  // need application identifiers + team + the identical keychain-access-groups entitlement.
  const identifier = configurationFile.identifier;
  writeFileSync(
    entitlements,
    plist({
      "keychain-access-groups": [group],
      "com.apple.application-identifier": `${group.split(".")[0]}.${identifier}`,
      "com.apple.developer.team-identifier": team,
    }),
  );
  return {
    bundle: {
      macOS: {
        minimumSystemVersion: "14.0",
        signingIdentity: identity,
        hardenedRuntime: true,
        infoPlist: info,
        entitlements,
        files: {
          "PlugIns/IndexShareMac.appex": extension,
          "embedded.provisionprofile": resolve(hostProfile),
        },
      },
    },
  };
}

export function verifyShareExtension(args, productName = "Index") {
  const index = args.findIndex((arg) => ["--target", "-t"].includes(arg));
  const target =
    index >= 0 ? args[index + 1] : args.find((arg) => arg.startsWith("--target="))?.split("=")[1];
  const root = resolve(process.env.CARGO_TARGET_DIR ?? "src-tauri/target");
  const bundle = join(
    root,
    target ?? "",
    args.includes("--debug") ? "debug" : "release",
    `bundle/macos/${productName}.app`,
  );
  run("python3", ["scripts/verify-share-bundle.py", bundle]);
}
