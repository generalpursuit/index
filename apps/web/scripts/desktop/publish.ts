import { z } from "zod";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { channelForBranch } from "./channels.ts";
import { artifactMetadata, manifest, updateFeed } from "./artifacts.ts";

const channel = channelForBranch(process.env.GITHUB_REF_NAME);
const repository = process.env.GITHUB_REPOSITORY;
const version = process.env.INDEX_DESKTOP_VERSION;
const commit = process.env.GITHUB_SHA;
const directory = process.argv[2];
if (!repository || !version || !commit || !directory)
  throw new Error(
    "Set GITHUB_REPOSITORY, INDEX_DESKTOP_VERSION and GITHUB_SHA, and supply the artifact directory.",
  );
const root = resolve(directory);
const tag = `desktop-${channel}-v${version}`;
function gh(args: string[], allowedFailure?: false, input?: string): string;
function gh(args: string[], allowedFailure: true, input?: string): string | null;
function gh(args: string[], allowedFailure = false, input?: string) {
  const result = spawnSync("gh", args, { encoding: "utf8", env: process.env, input });
  if (result.status !== 0) {
    if (allowedFailure && /HTTP 404|release not found/i.test(result.stderr || "")) return null;
    throw new Error(result.stderr || "GitHub release operation failed.");
  }
  return result.stdout;
}
const parts = readdirSync(root)
  .filter((name) => /^metadata-.*\.json$/.test(name))
  .map((name) => artifactMetadata.parse(JSON.parse(readFileSync(join(root, name), "utf8"))));
const update = manifest(parts, { channel, version, repository, tag });
const feedPath = `repos/${repository}/contents/${channel}/latest.json`;
const feedExists = gh(["api", `repos/${repository}/git/ref/heads/desktop-updates`], true);
const current = feedExists ? gh(["api", `${feedPath}?ref=desktop-updates`], true) : null;
const currentFile = current
  ? z.object({ content: z.string(), sha: z.string() }).parse(JSON.parse(current))
  : null;
let alreadyCurrent = false;
if (currentFile) {
  const previous = updateFeed.parse(
    JSON.parse(Buffer.from(currentFile.content, "base64").toString()),
  );
  const order = Bun.semver.order(version, previous.version);
  if (order < 0)
    throw new Error("A newer version is already on this channel. Refusing to move it backwards.");
  alreadyCurrent = order === 0;
  if (
    alreadyCurrent &&
    Object.entries(update.platforms).some(
      ([platform, value]) =>
        previous.platforms?.[platform]?.url !== value.url ||
        previous.platforms?.[platform]?.signature !== value.signature,
    )
  )
    throw new Error("This version already points to different artifacts.");
}
const files: string[] = [];
const sums: string[] = [];
for (const part of parts)
  for (const [file, digest] of Object.entries(part.digests)) {
    if (
      file !== file.split(/[\\/]/).at(-1) ||
      createHash("sha256")
        .update(readFileSync(join(root, file)))
        .digest("hex") !== digest
    )
      throw new Error("Artifact checksum mismatch.");
    files.push(join(root, file));
    sums.push(`${digest}  ${file}`);
  }
const checksum = join(root, "SHA256SUMS.txt");
writeFileSync(checksum, sums.sort().join("\n") + "\n");
const notes = join(root, "release-notes.md");
writeFileSync(
  notes,
  `Index ${channel} ${version}\n\nBuilt from ${commit}.\n\nmacOS: signed and notarized, Apple Silicon and Intel.\nWindows: x64 NSIS installer (currently unsigned; Windows may show a publisher warning).\nLinux: x64 AppImage, Debian and RPM packages. Built on Ubuntu 22.04.\n\n${channel === "staging" ? "Install Index Staging alongside Index. It uses the staging service and its own login and update feed." : "This release uses the production service and receives production updates only."}\n\nFor in-app updates use AppImage on Linux; upgrade DEB/RPM packages through your package installer.\n`,
);
// A retry can resume a draft or advance a feed after publication failed partway through.
const existing = gh(
  ["release", "view", tag, "--repo", repository, "--json", "isDraft,targetCommitish"],
  true,
);
const existingRelease = existing
  ? z.object({ targetCommitish: z.string(), isDraft: z.boolean() }).parse(JSON.parse(existing))
  : null;
if (existingRelease && existingRelease.targetCommitish !== commit)
  throw new Error("The existing release belongs to a different commit.");
if (existingRelease && !existingRelease.isDraft) {
  const publishedSums = gh([
    "release",
    "download",
    tag,
    "--repo",
    repository,
    "--pattern",
    "SHA256SUMS.txt",
    "--output",
    "-",
  ]);
  if (publishedSums !== readFileSync(checksum, "utf8"))
    throw new Error(
      "Published artifact checksums differ. Run a new workflow; published files cannot be replaced.",
    );
  if (alreadyCurrent) {
    console.log(`${tag} is already published and current.`);
    process.exit(0);
  }
} else {
  if (alreadyCurrent)
    throw new Error("The current feed must refer to an already published release.");
  if (!existing)
    gh([
      "release",
      "create",
      tag,
      "--repo",
      repository,
      "--target",
      commit,
      "--title",
      `Index ${channel} ${version}`,
      "--notes-file",
      notes,
      "--draft",
      ...(channel === "staging" ? ["--prerelease"] : []),
    ]);
  gh(["release", "upload", tag, ...files, checksum, "--repo", repository, "--clobber"]);
  gh([
    "release",
    "edit",
    tag,
    "--repo",
    repository,
    "--draft=false",
    `--latest=${channel === "production"}`,
  ]);
}
// A contents API commit swaps the feed atomically; a failed request retains the old feed.
// The two channel files point only to immutable, already-published version assets.
if (!feedExists)
  gh(
    ["api", `repos/${repository}/git/refs`, "--method", "POST", "--input", "-"],
    false,
    JSON.stringify({ ref: "refs/heads/desktop-updates", sha: commit }),
  );
gh(
  ["api", feedPath, "--method", "PUT", "--input", "-"],
  false,
  JSON.stringify({
    message: `Release desktop ${channel} ${version}`,
    branch: "desktop-updates",
    content: Buffer.from(JSON.stringify(update, null, 2) + "\n").toString("base64"),
    ...(currentFile ? { sha: currentFile.sha } : {}),
  }),
);
console.log(`Published ${tag}; updated only the ${channel} feed.`);
