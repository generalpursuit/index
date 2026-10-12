import { readFileSync } from "node:fs";

export const channels = {
  production: {
    branch: "main",
    name: "Index",
    identifier: "com.generalpursuit.index",
    binary: "index",
    api: "https://index-production-api.generalpursuit.workers.dev",
    web: "https://index-production-web.generalpursuit.workers.dev",
    keychainSuffix: "com.generalpursuit.index.shared",
  },
  staging: {
    branch: "staging",
    name: "Index Staging",
    identifier: "com.generalpursuit.index.staging",
    binary: "index-staging",
    api: "https://index-staging-api.generalpursuit.workers.dev",
    web: "https://index-staging-web.generalpursuit.workers.dev",
    keychainSuffix: "com.generalpursuit.index.staging.shared",
  },
} as const;

export type Channel = keyof typeof channels;
export function isChannel(value: string | undefined): value is Channel {
  return value === "production" || value === "staging";
}

export type AppIdentity = {
  productName: string;
  identifier: string;
  version: string;
  bundle?: { macOS?: { bundleVersion?: string } };
};
export type BaseConfig = AppIdentity & {
  app: { windows: Array<Record<string, unknown> & { create?: boolean }> };
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// This module also runs in the release workflow before dependency installation.
// Preserve Tauri fields, validating the identity and windows used by these tools.
function parseBaseConfig(value: unknown): BaseConfig {
  if (
    !record(value) ||
    typeof value.productName !== "string" ||
    !value.productName ||
    typeof value.identifier !== "string" ||
    !value.identifier ||
    typeof value.version !== "string" ||
    !value.version ||
    !record(value.app) ||
    !Array.isArray(value.app.windows) ||
    !value.app.windows.every(
      (window: unknown) =>
        record(window) && (window.create === undefined || typeof window.create === "boolean"),
    )
  )
    throw new Error("Invalid desktop identity or app windows in tauri.conf.json.");
  const bundle = value.bundle;
  if (
    bundle !== undefined &&
    (!record(bundle) ||
      (bundle.macOS !== undefined &&
        (!record(bundle.macOS) ||
          (bundle.macOS.bundleVersion !== undefined &&
            typeof bundle.macOS.bundleVersion !== "string"))))
  )
    throw new Error("Invalid desktop bundle version in tauri.conf.json.");
  // The guards above cover the fields in this deliberately narrow consumer type.
  return value as BaseConfig;
}

export function channelForBranch(branch: string | undefined): Channel {
  const name = (Object.keys(channels) as Channel[]).find((key) => channels[key].branch === branch);
  if (!name) throw new Error("Desktop releases must come from main or staging.");
  return name;
}

export function releaseVersion(base: string, run: string | number) {
  if (!/^\d+\.\d+\.\d+$/.test(base) || !/^[1-9]\d*$/.test(String(run)))
    throw new Error("A numeric base version and positive workflow run number are required.");
  const [major = 0, minor = 0, patch = 0] = base.split(".").map(Number);
  const next = patch + Number(run);
  if (major > 255 || minor > 255 || !Number.isSafeInteger(next) || next > 65535)
    throw new Error(
      "Desktop version exceeds installer limits; revise the version counter before releasing.",
    );
  return `${major}.${minor}.${next}`;
}

export function releaseConfig(
  channel: string,
  base: BaseConfig,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!isChannel(channel)) throw new Error("Unknown desktop release channel.");
  const selected = channels[channel];
  const version = env.INDEX_DESKTOP_VERSION || base.version;
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Desktop versions must be numeric major.minor.patch.");
  const repository = env.INDEX_RELEASE_REPOSITORY || "generalpursuit/index";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid release repository.");
  const pubkey = env.INDEX_UPDATER_PUBLIC_KEY?.trim();
  if (env.CI && !pubkey)
    throw new Error("Set INDEX_UPDATER_PUBLIC_KEY for this release environment.");
  if (pubkey && !/^[A-Za-z0-9+/=]+$/.test(pubkey)) throw new Error("Invalid updater public key.");
  return {
    productName: selected.name,
    identifier: selected.identifier,
    mainBinaryName: selected.binary,
    version,
    app: { windows: base.app.windows.map((window) => ({ ...window, title: selected.name })) },
    bundle: {
      createUpdaterArtifacts: Boolean(pubkey),
      macOS: { minimumSystemVersion: "14.0", bundleVersion: version },
      windows: { allowDowngrades: false, nsis: { installMode: "currentUser" } },
    },
    plugins: pubkey
      ? {
          updater: {
            pubkey,
            requireSignedVersion: true,
            endpoints: [
              `https://raw.githubusercontent.com/${repository}/desktop-updates/${channel}/latest.json`,
            ],
            windows: { installMode: "passive" },
          },
        }
      : {},
  };
}

export function readBaseConfig() {
  return parseBaseConfig(
    JSON.parse(readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8")),
  );
}
