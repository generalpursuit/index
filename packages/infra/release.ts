import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { isReleaseStage, releaseBranch, type ReleaseStage } from "./deployment";

const releaseVersion = /^\d+\.\d+\.\d+$/;

function newer(version: string, than: string) {
  const [a, b] = [version, than].map((value) => value.split(".").map(Number));
  const different = a!.findIndex((part, i) => part !== b![i]);
  return different >= 0 && a![different]! > b![different]!;
}

/**
 * The root package.json version names every release, which runs from main. Staging ships it
 * without a bump, ordered by workflow run; production must exceed the latest `vX.Y.Z` tag.
 */
export function releaseIdentity(input: {
  branch: string | undefined;
  stage: string | undefined;
  packageVersion: unknown;
  run: string | undefined;
  tags: string[];
}): { stage: ReleaseStage; version: string } {
  if (input.branch !== releaseBranch) throw new Error("Releases run only from main.");
  const stage = input.stage;
  if (!stage || !isReleaseStage(stage))
    throw new Error("Choose the staging or production release stage.");
  const version = input.packageVersion;
  if (typeof version !== "string" || !releaseVersion.test(version))
    throw new Error("Set the root package.json version to major.minor.patch.");
  if (stage === "staging") {
    if (!input.run || !/^[1-9]\d*$/.test(input.run))
      throw new Error("Staging versions require a positive workflow run number.");
    return { stage, version: `${version}-staging.${input.run}` };
  }
  const latest = input.tags
    .map((tag) => tag.slice(1))
    .filter((tag) => releaseVersion.test(tag))
    .reduce<string | undefined>((max, tag) => (!max || newer(tag, max) ? tag : max), undefined);
  if (latest && !newer(version, latest))
    throw new Error(
      `Version ${version} is not higher than the released v${latest}. Bump the root package.json version.`,
    );
  return { stage, version };
}

if (import.meta.main) {
  const remote = spawnSync("git", ["ls-remote", "--tags", "--refs", "origin", "refs/tags/v*"], {
    encoding: "utf8",
  });
  if (remote.status !== 0) throw new Error(remote.stderr || "Could not list release tags.");
  const { stage, version } = releaseIdentity({
    branch: process.env.GITHUB_REF_NAME,
    stage: process.env.RELEASE_STAGE,
    packageVersion: JSON.parse(
      readFileSync(join(import.meta.dirname, "../../package.json"), "utf8"),
    ).version,
    run: process.env.GITHUB_RUN_NUMBER,
    tags: [...remote.stdout.matchAll(/refs\/tags\/(v\S+)/g)].map((match) => match[1]!),
  });
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `stage=${stage}\nversion=${version}\n`);
  console.log(`Releasing ${version} to ${stage}.`);
}
