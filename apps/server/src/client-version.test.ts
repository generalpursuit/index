import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isUnsupportedClient, minimumClientVersions } from "./client-version";

describe("client version gate", () => {
  const [major, minor, patch] = minimumClientVersions.desktop.split(".").map(Number) as [
    number,
    number,
    number,
  ];
  it("rejects identified releases below their platform minimum", () => {
    if (patch > 0) assert.ok(isUnsupportedClient(`desktop/${major}.${minor}.${patch - 1}`));
    assert.ok(isUnsupportedClient("desktop/0.0.1"));
    assert.ok(isUnsupportedClient("ios/0.0.1-staging.99"));
  });
  it("accepts the minimum, newer releases and their staging builds", () => {
    for (const version of [
      `${major}.${minor}.${patch}`,
      `${major}.${minor}.${patch}-staging.3`,
      `${major}.${minor}.${patch + 1}`,
      `${major}.${minor + 1}.0`,
      `${major + 1}.0.0`,
    ])
      assert.equal(isUnsupportedClient(`desktop/${version}`), false, version);
  });
  it("does not gate unidentified, unknown or malformed clients", () => {
    for (const identity of [
      undefined,
      "",
      "desktop",
      "desktop/next",
      "toaster/0.0.1",
      "constructor/0.0.1",
      "desktop/0.0",
    ])
      assert.equal(isUnsupportedClient(identity), false, String(identity));
  });
});
