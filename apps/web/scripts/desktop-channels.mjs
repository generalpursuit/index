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
};

export function channelForBranch(branch) {
  const name = Object.keys(channels).find((key) => channels[key].branch === branch);
  if (!name) throw new Error("Desktop releases must come from main or staging.");
  return name;
}

export function releaseVersion(base, run) {
  if (!/^\d+\.\d+\.\d+$/.test(base) || !/^[1-9]\d*$/.test(String(run)))
    throw new Error("A numeric base version and positive workflow run number are required.");
  const [major, minor, patch] = base.split(".").map(Number);
  const next = patch + Number(run);
  if (major > 255 || minor > 255 || !Number.isSafeInteger(next) || next > 65535)
    throw new Error(
      "Desktop version exceeds installer limits; revise the version counter before releasing.",
    );
  return `${major}.${minor}.${next}`;
}

export function releaseConfig(channel, base, env = process.env) {
  const selected = channels[channel];
  if (!selected) throw new Error("Unknown desktop release channel.");
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
  return JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
}
