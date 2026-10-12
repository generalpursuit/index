import assert from "node:assert/strict";
import { z } from "zod";
import type { SpawnSyncReturns } from "node:child_process";
import { artifactMetadata, updateFeed } from "./artifacts.ts";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

// Execute the real publisher against a disposable GitHub CLI double. No network or tokens.
const cli = `#!${process.execPath}
import { readFileSync, writeFileSync } from 'node:fs';
const file = process.env.INDEX_TEST_GITHUB_STATE;
const state = JSON.parse(readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
state.calls.push(args);
function done(value = '') { writeFileSync(file, JSON.stringify(state)); console.log(typeof value === 'string' ? value : JSON.stringify(value)); }
function fail(message) { writeFileSync(file, JSON.stringify(state)); console.error(message); process.exit(1); }
if (state.forbidden) fail('HTTP 403: Forbidden');
if (args[0] === 'api') {
  const path = args[1];
  if (path.endsWith('/git/ref/heads/desktop-updates')) {
    if (!state.branch) fail('HTTP 404: Not Found');
    done({ object: { sha: 'branch-sha' } });
  } else if (path.includes('/contents/')) {
    const channel = path.includes('/staging/') ? 'staging' : 'production';
    if (args.includes('PUT')) {
      if (state.failFeed) fail('HTTP 500: Failed feed commit');
      const body = JSON.parse(await Bun.stdin.text());
      state.feeds[channel] = JSON.parse(Buffer.from(body.content, 'base64').toString());
      done({});
    } else {
      if (!state.feeds[channel]) fail('HTTP 404: Not Found');
      done({ sha: 'feed-sha', content: Buffer.from(JSON.stringify(state.feeds[channel])).toString('base64') });
    }
  } else if (path.endsWith('/git/refs')) { state.branch = true; done({}); }
  else fail('Unexpected API call');
} else if (args[0] === 'release') {
  if (args[1] === 'view') {
    if (!state.release) fail('release not found');
    done(state.release);
  } else if (args[1] === 'create') {
    state.release = { isDraft: true, targetCommitish: args[args.indexOf('--target') + 1] }; done();
  } else if (args[1] === 'upload') {
    if (state.failUpload) fail('Upload failed');
    state.sums = readFileSync(args.find(a => a.endsWith('SHA256SUMS.txt')), 'utf8'); done();
  } else if (args[1] === 'edit') { state.release.isDraft = false; done(); }
  else if (args[1] === 'download') { writeFileSync(file, JSON.stringify(state)); process.stdout.write(state.sums); }
  else fail('Unexpected release command');
} else fail('Unexpected command');
`;

const githubState = z.object({
  calls: z.array(z.array(z.string())),
  branch: z.boolean(),
  feeds: z.object({ production: updateFeed.optional(), staging: updateFeed.optional() }),
  release: z.object({ isDraft: z.boolean(), targetCommitish: z.string() }).optional(),
  sums: z.string().optional(),
  failFeed: z.boolean().optional(),
  failUpload: z.boolean().optional(),
  forbidden: z.boolean().optional(),
});
type GithubState = z.infer<typeof githubState>;
type Fixture = {
  publish(): SpawnSyncReturns<string>;
  read(): GithubState;
  save(state: GithubState): void;
  artifacts: string;
};
function fixture(run: (fixture: Fixture) => void) {
  const root = mkdtempSync(join(tmpdir(), "index-publish-test-"));
  try {
    const bin = join(root, "bin");
    const artifacts = join(root, "artifacts");
    mkdirSync(bin);
    mkdirSync(artifacts);
    writeFileSync(join(bin, "gh"), cli, { mode: 0o700 });
    const statePath = join(root, "github.json");
    const state: GithubState = {
      calls: [],
      branch: false,
      feeds: { production: { version: "0.1.10" } },
    };
    const save = (value: GithubState) => writeFileSync(statePath, JSON.stringify(value));
    const read = () => githubState.parse(JSON.parse(readFileSync(statePath, "utf8")));
    save(state);
    for (const platform of ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"]) {
      const file = `staging-${platform}-installer`;
      writeFileSync(join(artifacts, file), platform);
      writeFileSync(
        join(artifacts, `metadata-${platform}.json`),
        JSON.stringify({
          channel: "staging",
          version: "0.2.0-staging.42",
          platform,
          file,
          signature: "c2ln",
          digests: { [file]: createHash("sha256").update(platform).digest("hex") },
        }),
      );
    }
    const publish = () =>
      spawnSync(process.execPath, [resolve(import.meta.dir, "./publish.ts"), artifacts], {
        encoding: "utf8",
        env: {
          PATH: bin + delimiter + process.env.PATH,
          INDEX_TEST_GITHUB_STATE: statePath,
          GITHUB_REF_NAME: "staging",
          GITHUB_REPOSITORY: "generalpursuit/index",
          INDEX_DESKTOP_VERSION: "0.2.0-staging.42",
          GITHUB_SHA: "release-commit",
        },
      });
    run({ publish, read, save, artifacts });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("desktop publication transaction", () => {
  test("malformed artifact metadata is rejected before any GitHub operation", () =>
    fixture(({ publish, read, artifacts }) => {
      const path = join(artifacts, "metadata-linux-x86_64.json");
      const original = artifactMetadata.parse(JSON.parse(readFileSync(path, "utf8")));
      for (const changed of [
        { ...original, platform: "unknown" },
        { ...original, version: "not-a-version" },
        { ...original, signature: null },
        { ...original, digests: { [original.file]: 42 } },
      ]) {
        writeFileSync(path, JSON.stringify(changed));
        expect(publish().status).not.toBe(0);
        expect(read().calls).toEqual([]);
      }
    }));
  test("publishes all assets before advancing only staging; replay is idempotent", () =>
    fixture(({ publish, read }) => {
      const result = publish();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const state = read();
      assert.ok(state.release && state.feeds.staging);
      expect(state.release.isDraft).toBe(false);
      expect(state.feeds.staging.version).toBe("0.2.0-staging.42");
      expect(state.feeds.production).toEqual({ version: "0.1.10" });
      const upload = state.calls.findIndex((args) => args[1] === "upload");
      const publishIndex = state.calls.findIndex((args) => args[1] === "edit");
      const feed = state.calls.findIndex((args) => args.includes("PUT"));
      expect(upload).toBeLessThan(publishIndex);
      expect(publishIndex).toBeLessThan(feed);
      expect(publish().status).toBe(0);
      expect(read().calls.filter((args) => args[1] === "upload")).toHaveLength(1);
    }));
  test("an upload failure leaves the old feed and an unpublished draft", () =>
    fixture(({ publish, read, save }) => {
      save({ ...read(), failUpload: true });
      expect(publish().status).not.toBe(0);
      expect(read().release?.isDraft).toBe(true);
      expect(read().feeds.staging).toBeUndefined();
      save({ ...read(), failUpload: false });
      expect(publish().status).toBe(0);
    }));
  test("a feed failure resumes the published release without replacing its files", () =>
    fixture(({ publish, read, save }) => {
      save({ ...read(), failFeed: true });
      expect(publish().status).not.toBe(0);
      expect(read().release?.isDraft).toBe(false);
      expect(read().feeds.staging).toBeUndefined();
      save({ ...read(), failFeed: false });
      expect(publish().status).toBe(0);
      expect(read().calls.filter((args) => args[1] === "upload")).toHaveLength(1);
      expect(read().feeds.staging?.version).toBe("0.2.0-staging.42");
    }));
  test("newer channel versions and GitHub permission failures cannot be overwritten", () =>
    fixture(({ publish, read, save }) => {
      save({ ...read(), branch: true, feeds: { staging: { version: "0.2.0-staging.43" } } });
      expect(publish().status).not.toBe(0);
      expect(read().release).toBeUndefined();
      save({ ...read(), forbidden: true });
      expect(publish().status).not.toBe(0);
      expect(read().release).toBeUndefined();
    }));
  test("corrupted local artifacts and changed published checksums are rejected", () =>
    fixture(({ publish, read, save, artifacts }) => {
      expect(publish().status).toBe(0);
      save({ ...read(), sums: "different" });
      expect(publish().status).not.toBe(0);
      writeFileSync(join(artifacts, "staging-linux-x86_64-installer"), "corrupt");
      expect(publish().status).not.toBe(0);
      expect(read().calls.filter((args) => args[1] === "upload")).toHaveLength(1);
    }));
});
