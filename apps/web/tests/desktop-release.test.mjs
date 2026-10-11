import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  channels,
  channelForBranch,
  readBaseConfig,
  releaseConfig,
  releaseVersion,
} from "../scripts/desktop-channels.mjs";
import { collect, manifest, updaterFiles } from "../scripts/desktop-artifacts.mjs";

describe("desktop release isolation", () => {
  test("branches cannot select the other release channel", () => {
    expect(channelForBranch("main")).toBe("production");
    expect(channelForBranch("staging")).toBe("staging");
    for (const branch of ["dev", "feature/staging", "main;echo bad", ""])
      expect(() => channelForBranch(branch)).toThrow();
  });
  test("installed apps, credentials, server scopes and signed feeds are separate", () => {
    const base = readBaseConfig();
    const staging = releaseConfig("staging", base, { INDEX_UPDATER_PUBLIC_KEY: "c3RhZ2luZw==" });
    const production = releaseConfig("production", base, { INDEX_UPDATER_PUBLIC_KEY: "cHJvZA==" });
    for (const key of ["productName", "identifier", "mainBinaryName"])
      expect(staging[key]).not.toBe(production[key]);
    for (const key of ["api", "web", "keychainSuffix"])
      expect(channels.staging[key]).not.toBe(channels.production[key]);
    expect(staging.plugins.updater.endpoints[0]).toEndWith("/staging/latest.json");
    expect(production.plugins.updater.endpoints[0]).toEndWith("/production/latest.json");
    expect(production.plugins.updater.pubkey).not.toBe(staging.plugins.updater.pubkey);
    expect(production.plugins.updater.requireSignedVersion).toBe(true);
    expect(staging.bundle.windows.allowDowngrades).toBe(false);
    expect(staging.app.windows[0].create).toBe(false);
  });
  test("CI cannot silently ship builds without a verifiable update key", () => {
    expect(() => releaseConfig("production", readBaseConfig(), { CI: "true" })).toThrow();
    expect(() =>
      releaseConfig("staging", readBaseConfig(), { INDEX_RELEASE_REPOSITORY: "../../other" }),
    ).toThrow();
    expect(() => releaseConfig("unknown", readBaseConfig(), {})).toThrow();
  });
  test("workflow versions advance and remain valid for native installers", () => {
    expect(releaseVersion("0.1.0", "42")).toBe("0.1.42");
    expect(releaseVersion("0.1.0", "43")).toBe("0.1.43");
    for (const value of ["0", "-1", "wat", "65536"])
      expect(() => releaseVersion("0.1.0", value)).toThrow();
    expect(() => releaseVersion("0.1.0-beta", "1")).toThrow();
  });
});

describe("complete release manifests", () => {
  const options = {
    channel: "staging",
    version: "0.1.42",
    repository: "generalpursuit/index",
    tag: "desktop-staging-v0.1.42",
  };
  const parts = Object.keys(updaterFiles).map((platform) => ({
    channel: options.channel,
    version: options.version,
    platform,
    signature: "c2ln",
    file: `staging-${platform}-Index${updaterFiles[platform]}`,
  }));
  test("all target URLs select immutable artifacts of the same channel and version", () => {
    const result = manifest(parts, options);
    expect(Object.keys(result.platforms)).toHaveLength(4);
    for (const platform of Object.values(result.platforms))
      expect(platform.url).toContain("/releases/download/desktop-staging-v0.1.42/staging-");
  });
  test("missing, duplicate, cross-channel and mixed-version artifacts cannot publish", () => {
    expect(() => manifest(parts.slice(1), options)).toThrow();
    expect(() => manifest([parts[0], ...parts.slice(0, 3)], options)).toThrow();
    expect(() =>
      manifest([{ ...parts[0], channel: "production" }, ...parts.slice(1)], options),
    ).toThrow();
    expect(() =>
      manifest([{ ...parts[0], version: "0.1.43" }, ...parts.slice(1)], options),
    ).toThrow();
  });
  test("collects only distributables, checksums the bytes and requires a signature", () => {
    const root = mkdtempSync(join(tmpdir(), "index-artifacts-"));
    try {
      const input = join(root, "bundle");
      const output = join(root, "out");
      mkdirSync(input);
      writeFileSync(join(input, "Index Staging.AppImage"), "test artifact");
      writeFileSync(join(input, "signing-key.p8"), "must not be collected");
      expect(() => collect(input, output, { ...options, platform: "linux-x86_64" })).toThrow();
      writeFileSync(join(input, "Index Staging.AppImage.sig"), "c2ln");
      writeFileSync(join(input, "index-staging.deb"), "deb");
      writeFileSync(join(input, "index-staging.rpm"), "rpm");
      const metadata = collect(input, output, { ...options, platform: "linux-x86_64" });
      expect(Object.keys(metadata.digests)).toHaveLength(4);
      expect(readFileSync(join(output, metadata.file), "utf8")).toBe("test artifact");
      expect(metadata.digests[metadata.file]).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
