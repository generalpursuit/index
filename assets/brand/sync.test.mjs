import assert from "node:assert/strict";
import { orderedIcns } from "./icns.mjs";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let fixture;
before(() => {
  fixture = mkdtempSync(join(tmpdir(), "index-brand-test-"));
  cpSync(join(root, "assets/brand"), join(fixture, "assets/brand"), { recursive: true });
  cpSync(
    join(root, "apps/web/scripts/menu-bar-icon.py"),
    join(fixture, "apps/web/scripts/menu-bar-icon.py"),
  );
  symlinkSync(join(root, "apps/web/node_modules"), join(fixture, "apps/web/node_modules"), "dir");
});
after(() => rmSync(fixture, { recursive: true, force: true }));
const run = (args, env = {}) =>
  spawnSync(process.execPath, [join(fixture, "assets/brand/sync.mjs"), ...args], {
    cwd: fixture,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
function outputSnapshot() {
  const files = readdirSync(join(fixture, "apps"), { recursive: true }).filter(
    (path) => !path.includes("node_modules") && statSync(join(fixture, "apps", path)).isFile(),
  );
  return files.map((path) => [
    path,
    readFileSync(join(fixture, "apps", path)).toString("base64"),
    statSync(join(fixture, "apps", path)).mtimeMs,
  ]);
}

it("generates scoped web assets without native tools and checks without touching outputs", () => {
  const generated = run(["--target", "web"], { RSVG_CONVERT: "/missing-converter" });
  assert.equal(generated.status, 0, generated.stderr);
  for (const size of [192, 512]) {
    const png = readFileSync(join(fixture, `apps/web/public/app-icon-${size}.png`));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  assert.deepEqual(
    readFileSync(join(fixture, "apps/web/public/favicon.svg")),
    readFileSync(join(root, "assets/brand/app-icon/favicon.svg")),
  );
  assert.equal(existsSync(join(fixture, "apps/ios")), false);
  assert.equal(existsSync(join(fixture, "apps/web/src-tauri")), false);
  const before = outputSnapshot();
  assert.equal(run(["--target", "web", "--check"]).status, 0);
  assert.deepEqual(outputSnapshot(), before);
});

it("reports changed source, stale and missing outputs without repairing them", () => {
  const source = join(fixture, "assets/brand/app-icon/favicon.svg");
  const original = readFileSync(source);
  writeFileSync(source, original.toString().replace("#0B0B0C", "#111111"));
  const before = outputSnapshot();
  const changed = run(["--target", "web", "--check"]);
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /Missing or stale.*[\s\S]*favicon.svg/);
  assert.deepEqual(outputSnapshot(), before);
  writeFileSync(source, original);
  const favicon = join(fixture, "apps/web/public/favicon.svg");
  const icon = join(fixture, "apps/web/public/app-icon-192.png");
  writeFileSync(favicon, "stale output");
  rmSync(icon);
  const damaged = outputSnapshot();
  const result = run(["--target", "web", "--check"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /app-icon-192.png/);
  assert.match(result.stderr, /favicon.svg/);
  assert.deepEqual(outputSnapshot(), damaged);
});

it("rejects missing prerequisites before changing any selected target", () => {
  const before = outputSnapshot();
  const result = run(["--target", "web", "--target", "desktop"], {
    RSVG_CONVERT: join(fixture, "missing-converter"),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires librsvg/);
  assert.deepEqual(outputSnapshot(), before);
  if (process.platform !== "darwin") {
    const native = run([]);
    assert.notEqual(native.status, 0);
    assert.match(native.stderr, /requires macOS and Xcode/);
    assert.deepEqual(outputSnapshot(), before);
  }
});

it(
  "does not publish an earlier staged target when later conversion fails",
  { skip: process.platform === "win32" },
  () => {
    const converter = join(fixture, "failing-converter");
    writeFileSync(
      converter,
      '#!/bin/sh\nif [ "$1" = "--help" ]; then echo pdf1.4; exit 0; fi\nexit 1\n',
      { mode: 0o755 },
    );
    const before = outputSnapshot();
    const result = run(["--target", "web", "--target", "desktop"], { RSVG_CONVERT: converter });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Menu-bar icon generation failed/);
    assert.deepEqual(outputSnapshot(), before);
  },
);

it("declares existing canonical favicon and 192/512 manifest resources without dropping the touch icon", () => {
  const html = readFileSync(join(root, "apps/web/index.html"), "utf8");
  assert.match(html, /rel="icon" href="\/favicon.ico"/);
  assert.match(html, /rel="icon" href="\/favicon.svg" type="image\/svg\+xml"/);
  assert.match(html, /rel="apple-touch-icon" href="\/app-icon.png"/);
  const manifest = JSON.parse(
    readFileSync(join(root, "apps/web/public/manifest.webmanifest"), "utf8"),
  );
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((icon) => icon.sizes === `${size}x${size}`);
    assert.equal(icon?.type, "image/png");
    assert.equal(icon?.purpose, "any");
    assert.ok(existsSync(join(root, "apps/web/public", icon.src)));
  }
});

it("normalizes ICNS order while preserving every encoded image and mask", () => {
  const original = readFileSync(join(root, "apps/web/src-tauri/icons/icon.icns"));
  const elements = [];
  for (let offset = 8; offset < original.length;) {
    const end = offset + original.readUInt32BE(offset + 4);
    elements.push(original.subarray(offset, end));
    offset = end;
  }
  assert.equal(elements.length, 12);
  const reversed = Buffer.concat([original.subarray(0, 8), ...elements.toReversed()]);
  assert.deepEqual(orderedIcns(reversed), orderedIcns(original));
  assert.equal(orderedIcns(original).length, original.length);
  for (const element of elements) assert.ok(orderedIcns(original).includes(element));
  for (const malformed of [
    Buffer.alloc(0),
    Buffer.from("icns0000"),
    original.subarray(0, -1),
    Buffer.from("69636e7300000008", "hex"),
  ])
    assert.throws(() => orderedIcns(malformed), /ICNS/);
  for (const length of [0, 7, original.length + 1]) {
    const malformed = Buffer.from(original);
    malformed.writeUInt32BE(length, 12);
    assert.throws(() => orderedIcns(malformed), /ICNS/);
  }
});
