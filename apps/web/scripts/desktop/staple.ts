import { spawnSync } from "node:child_process";

/**
 * Tauri staples right after Apple accepts the notarization, but the ticket can take a moment to
 * be published, and Tauri goes on without it. Stapling until it holds keeps the DMG, which is
 * built from this app next, carrying the ticket offline Gatekeeper checks need.
 */
export function stapleApp(app: string, attempts = 6, wait = sleep, stapler = xcrunStapler) {
  for (let attempt = 1; ; attempt++) {
    if (stapler("validate", app) === 0 || stapler("staple", app) === 0) return;
    if (attempt === attempts)
      throw new Error(`Could not staple the notarization ticket to ${app}.`);
    console.log(`The notarization ticket is not available yet; retrying in ${attempt * 15}s.`);
    wait(attempt * 15_000);
  }
}

function xcrunStapler(command: "validate" | "staple", app: string) {
  return spawnSync("xcrun", ["stapler", command, app], { stdio: "inherit" }).status;
}

function sleep(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
