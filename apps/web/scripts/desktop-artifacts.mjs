import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export const updaterFiles = {
  "darwin-aarch64": ".app.tar.gz",
  "darwin-x86_64": ".app.tar.gz",
  "linux-x86_64": ".AppImage",
  "windows-x86_64": ".exe",
};

function walk(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    // Never collect contents of an app, signing files, or unrelated build outputs.
    return entry.isDirectory() && !entry.name.endsWith(".app")
      ? walk(path)
      : entry.isFile()
        ? [path]
        : [];
  });
}

export function collect(bundle, destination, { platform, channel, version }) {
  if (
    !updaterFiles[platform] ||
    !["staging", "production"].includes(channel) ||
    !/^\d+\.\d+\.\d+$/.test(version)
  )
    throw new Error("Invalid artifact identity.");
  mkdirSync(destination, { recursive: true });
  const files = walk(bundle).filter((path) =>
    /\.(dmg|deb|rpm|AppImage|exe|msi|app\.tar\.gz)(\.sig)?$/.test(path),
  );
  const updater = files.filter((path) => path.endsWith(updaterFiles[platform]));
  if (updater.length !== 1) throw new Error(`Expected one updater artifact for ${platform}.`);
  const required = platform.startsWith("darwin")
    ? [".dmg"]
    : platform.startsWith("linux")
      ? [".deb", ".rpm"]
      : [".exe"];
  for (const extension of required)
    if (files.filter((file) => file.endsWith(extension)).length !== 1)
      throw new Error(`Missing or ambiguous ${extension} installer for ${platform}.`);
  const signature = readFileSync(`${updater[0]}.sig`, "utf8").trim();
  if (!signature || !/^[A-Za-z0-9+/=]+$/.test(signature))
    throw new Error("Missing or invalid updater signature.");
  const prefix = `${channel}-${platform}-`;
  const digests = {};
  for (const file of files) {
    const name = prefix + basename(file).replaceAll(" ", "_");
    if (digests[name]) throw new Error("Duplicate artifact name.");
    copyFileSync(file, join(destination, name));
    digests[name] = createHash("sha256").update(readFileSync(file)).digest("hex");
  }
  const metadata = {
    channel,
    version,
    platform,
    file: prefix + basename(updater[0]).replaceAll(" ", "_"),
    signature,
    digests,
  };
  writeFileSync(join(destination, `metadata-${platform}.json`), JSON.stringify(metadata, null, 2));
  return metadata;
}

export function manifest(
  parts,
  { channel, version, repository, tag, now = new Date().toISOString() },
) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[\w.-]+$/.test(tag))
    throw new Error("Invalid release destination.");
  if (
    parts.length !== Object.keys(updaterFiles).length ||
    new Set(parts.map((part) => part.platform)).size !== parts.length
  )
    throw new Error("A release needs all four native targets.");
  const platforms = {};
  for (const part of parts) {
    if (
      part.channel !== channel ||
      part.version !== version ||
      !updaterFiles[part.platform] ||
      !part.file.startsWith(`${channel}-${part.platform}-`)
    )
      throw new Error("Mixed channel, version, or platform artifacts cannot be published.");
    platforms[part.platform] = {
      signature: part.signature,
      url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(part.file)}`,
    };
  }
  return { version, notes: `Index ${channel} ${version}`, pub_date: now, platforms };
}

if (import.meta.main) {
  const [bundle, destination] = process.argv.slice(2);
  collect(resolve(bundle), resolve(destination), {
    platform: process.env.INDEX_UPDATE_PLATFORM,
    channel: process.env.INDEX_DESKTOP_CHANNEL,
    version: process.env.INDEX_DESKTOP_VERSION,
  });
}
