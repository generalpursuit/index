import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const runner = join(web, "scripts/desktop-dev-runner.mjs");
const devConfig = join(web, "src-tauri/tauri.dev.conf.json");

describe("macOS desktop development", { skip: process.platform !== "darwin" }, () => {
  let temporary: string;
  let binary: string;
  before(() => {
    temporary = mkdtempSync(join(tmpdir(), "index desktop dev "));
    binary = join(temporary, "notification-check");
    const result = spawnSync(
      "xcrun",
      [
        "clang",
        "-fobjc-arc",
        "-fblocks",
        join(web, "tests/fixtures/desktop-dev.m"),
        join(web, "src-tauri/native/notifications.m"),
        "-framework",
        "AppKit",
        "-framework",
        "UserNotifications",
        "-framework",
        "Security",
        "-o",
        binary,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  });
  after(() => rmSync(temporary, { recursive: true, force: true }));

  test("an unbundled process reports notifications unavailable without crashing or waiting", () => {
    const result = spawnSync(binary, [], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).permission, -1);
  });

  const environment = () => ({
    ...process.env,
    TAURI_CONFIG: JSON.stringify({
      ...JSON.parse(readFileSync(devConfig, "utf8")),
      productName: "Index Runner Test",
      identifier: "com.generalpursuit.index.runner-test",
    }),
    INDEX_RUNNER_TEST: "inherited value",
  });

  test("the dev runner enables the real bridge and preserves arguments, environment, and exit status", () => {
    const result = spawnSync(process.execPath, [runner, binary, "argument with spaces"], {
      cwd: join(web, "src-tauri"),
      env: environment(),
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stderr);
    const state = JSON.parse(result.stdout);
    assert.equal(state.identifier, "com.generalpursuit.index.runner-test");
    assert.equal(state.delegate, "IndexNotificationDelegate");
    assert.ok(state.permission >= 0, result.stdout);
    assert.equal(state.arguments[1], "argument with spaces");
    assert.equal(state.environment, "inherited value");
    assert.equal(state.bundle, join(temporary, "bundle/dev/Index Runner Test.app"));
    const signature = spawnSync("codesign", ["--verify", "--deep", "--strict", state.bundle], {
      encoding: "utf8",
    });
    assert.equal(signature.status, 0, signature.stderr);
    const failure = spawnSync(process.execPath, [runner, binary, "--exit-failure"], {
      cwd: join(web, "src-tauri"),
      env: environment(),
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.equal(failure.status, 23, failure.stderr);
  });

  test("the runner becomes the app process so killing it leaves no app behind", async () => {
    const child = spawn(process.execPath, [runner, binary, "--wait"], {
      cwd: join(web, "src-tauri"),
      env: environment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    child.stderr.on("data", (data) => {
      errors += data;
    });
    const exited = new Promise((resolve) =>
      child.on("exit", (code, signal) => resolve({ code, signal })),
    );
    try {
      const state = await new Promise<{ pid: number }>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Runner did not start: ${errors}`)),
          15_000,
        );
        child.on("error", reject);
        child.on("exit", () => {
          clearTimeout(timer);
          reject(new Error(`Runner exited: ${errors}`));
        });
        child.stdout.on("data", (data) => {
          output += data;
          if (output.includes("\n")) {
            clearTimeout(timer);
            resolve(JSON.parse(output));
          }
        });
      });
      assert.equal(state.pid, child.pid, "Tauri must retain the actual app's PID");
      child.kill("SIGTERM");
      assert.deepEqual(await exited, { code: null, signal: "SIGTERM" });
      assert.throws(() => process.kill(state.pid, 0), { code: "ESRCH" });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    }
  });
});
