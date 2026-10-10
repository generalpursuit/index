import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (process.platform !== "darwin") throw new Error("This native smoke runner requires macOS.");
const fixture = await fetch("http://localhost:3002/_test/fixture").then((r) => r.json());
if (!fixture.people?.Alice)
  throw new Error("Start the disposable API with bun e2e/server.mjs first.");
const env = {
  ...process.env,
  VITE_SERVER_URL: "http://localhost:3002",
};
const logs = mkdtempSync(join(tmpdir(), "index-native-smoke-"));
const bundle = resolve("src-tauri/target/release/bundle/macos/Index.app");
const run = (command, args) => {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}). Logs: ${logs}`);
};
const clearTestCredential = () => {
  // This service exists only in smoke builds, never for real app sessions.
  const result = spawnSync(
    "security",
    [
      "delete-generic-password",
      "-s",
      "com.generalpursuit.index.native-smoke",
      "-a",
      env.VITE_SERVER_URL,
    ],
    { stdio: "ignore" },
  );
  if (![0, 44].includes(result.status))
    throw new Error("Could not clear the isolated smoke credential.");
};
run("bun", ["run", "desktop:build", "--local", "--features", "native-smoke", "--bundles", "app"]);
clearTestCredential();
try {
  for (const phase of ["login", "restore", "signed-out"]) {
    const stdout = join(logs, `${phase}.log`);
    const stderr = join(logs, `${phase}.errors.log`);
    run("open", [
      "-n",
      "-W",
      "--env",
      `INDEX_NATIVE_SMOKE_PHASE=${phase}`,
      "--stdout",
      stdout,
      "--stderr",
      stderr,
      bundle,
    ]);
    const output = readFileSync(stdout, "utf8") + readFileSync(stderr, "utf8");
    if (!output.includes("Native smoke passed") || output.includes("Native smoke failed")) {
      throw new Error(`Native ${phase} failed. Logs: ${logs}\n${output}`);
    }
    console.log(`Native ${phase}: passed`);
  }
} finally {
  clearTestCredential();
  // Restore the normal app bundle so a test-only executable cannot be mistaken for the app.
  run("bun", ["run", "desktop:build", "--local", "--without-share-extension", "--bundles", "app"]);
}
console.log(`Native smoke passed. Logs: ${logs}`);
