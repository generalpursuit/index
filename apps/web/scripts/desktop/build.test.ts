import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const web = fileURLToPath(new URL("../../", import.meta.url));
const build = fileURLToPath(new URL("./build.ts", import.meta.url));
const invocation = z.object({
  args: z.array(z.string()),
  api: z.string(),
  channel: z.string().optional(),
});
function fixture(
  run: (invoke: (args: string[], api?: string) => ReturnType<typeof execute>) => void,
) {
  const root = mkdtempSync(join(tmpdir(), "index-build-test-"));
  const capture = join(root, "invocation.json");
  function execute(args: string[], api = "http://localhost:3002/") {
    rmSync(capture, { force: true });
    const result = spawnSync(process.execPath, [build, ...args], {
      cwd: web,
      encoding: "utf8",
      env: {
        PATH: root + delimiter + process.env.PATH,
        INDEX_TEST_CAPTURE: capture,
        VITE_SERVER_URL: api,
      },
    });
    return {
      ...result,
      captured: () => invocation.parse(JSON.parse(readFileSync(capture, "utf8"))),
    };
  }
  try {
    // Capture the real build wrapper's Tauri invocation without compiling or signing.
    writeFileSync(
      join(root, "bun"),
      `#!${process.execPath}\nimport { writeFileSync } from "node:fs";\nwriteFileSync(process.env.INDEX_TEST_CAPTURE, JSON.stringify({ args: process.argv.slice(2), api: process.env.VITE_SERVER_URL, channel: process.env.INDEX_DESKTOP_CHANNEL }));\n`,
      { mode: 0o700 },
    );
    run(execute);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("desktop build entrypoint", () => {
  test("normalizes local API scope, supplies CSP, and forwards only Tauri flags", () =>
    fixture((invoke) => {
      const result = invoke(["--local", "--without-share-extension", "--bundles", "app"]);
      assert.equal(result.status, 0, result.stderr);
      const captured = result.captured();
      assert.equal(captured.api, "http://localhost:3002");
      assert.deepEqual(captured.args.slice(0, 5), [
        "x",
        "--no-install",
        "tauri",
        "build",
        "--config",
      ]);
      assert.deepEqual(captured.args.slice(6), ["--bundles", "app"]);
      const config = z
        .object({
          app: z.object({ security: z.object({ csp: z.record(z.string(), z.string()) }) }),
        })
        .parse(JSON.parse(captured.args[5]!));
      assert.equal(
        config.app.security.csp["connect-src"],
        "'self' ipc: http://ipc.localhost http://localhost:3002",
      );
    }));
  test("release channels reject overrides and local/test hooks before launching tools", () =>
    fixture((invoke) => {
      for (const args of [
        ["--channel"],
        ["--channel", "dev"],
        ["--channel", "staging", "--local"],
        ["--channel", "production", "--without-share-extension"],
        ["--channel", "production", "--debug"],
        ["--channel", "staging", "--config=other.json"],
        ["--channel", "staging", "--features", "native-smoke"],
      ]) {
        const result = invoke(args);
        assert.notEqual(result.status, 0);
        assert.throws(result.captured, /ENOENT/);
      }
    }));
  test("rejects unsafe server URLs before launching tools", () =>
    fixture((invoke) => {
      for (const api of [
        "http://remote.example",
        "https://user:pass@example.com",
        "https://example.com/?token=x",
        "invalid",
      ]) {
        const result = invoke(["--local", "--without-share-extension"], api);
        assert.notEqual(result.status, 0);
        assert.throws(result.captured, /ENOENT/);
      }
    }));
  test.skipIf(process.platform === "darwin")(
    "release identity ignores ambient development API values",
    () =>
      fixture((invoke) => {
        const result = invoke(["--channel", "staging"], "http://localhost:9999");
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.captured().channel, "staging");
        assert.equal(result.captured().api, "https://index-staging-api.generalpursuit.workers.dev");
      }),
  );
  test.skipIf(process.platform === "darwin")(
    "native entrypoints fail clearly without macOS",
    () => {
      for (const [script, message] of [
        ["dev.ts", /macOS runner/],
        ["smoke.ts", /requires macOS/],
      ] as const) {
        const result = spawnSync(
          process.execPath,
          [fileURLToPath(new URL(script, import.meta.url))],
          { cwd: web, encoding: "utf8" },
        );
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, message);
      }
    },
  );
});
