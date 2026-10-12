import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import { deferDmg, dmgSettings } from "./dmg.ts";

describe("macOS DMG packaging", () => {
  test("Tauri builds the app while the DMG is packaged separately", () => {
    for (const [args, expected] of [
      [
        ["--bundles", "app,dmg"],
        ["--bundles", "app"],
      ],
      [
        ["--target", "x86_64-apple-darwin", "-b", "dmg"],
        ["--target", "x86_64-apple-darwin", "--bundles", "app"],
      ],
      [["--bundles=dmg,app"], ["--bundles", "app"]],
      [[], ["--bundles", "app"]],
    ] as const)
      assert.deepEqual(deferDmg([...args], "darwin"), { args: expected, dmg: true });
  });
  test("leaves other bundles and platforms to Tauri", () => {
    for (const [args, platform] of [
      [["--bundles", "app"], "darwin"],
      [["--no-bundle"], "darwin"],
      [["--bundles", "appimage,deb,rpm"], "linux"],
      [[], "win32"],
    ] as const)
      assert.deepEqual(deferDmg([...args], platform), { args, dmg: false });
  });
  test("lays out both icons symmetrically inside the background window", () => {
    const settings = dmgSettings("/build/Index Staging.app", "Index Staging");
    const { width, height } = settings.window.size;
    const [app, applications] = settings.contents;
    assert.equal(settings.title, "Index Staging");
    assert.deepEqual(app, {
      x: 140,
      y: 130,
      type: "file",
      path: "/build/Index Staging.app",
      hide_extension: true,
    });
    assert.equal(applications?.path, "/Applications");
    assert.equal(width - (applications?.x ?? 0), app?.x);
    assert.equal(applications?.y, app?.y);
    assert.ok(app && app.y + settings["icon-size"] < height);
  });
});
