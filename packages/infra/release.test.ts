import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { releaseIdentity } from "./release";

const release = (
  stage: string | undefined,
  tags: string[] = [],
  packageVersion: unknown = "0.3.0",
) => releaseIdentity({ branch: "main", stage, packageVersion, run: "42", tags });

describe("release identity", () => {
  it("ships the package version to production and orders staging builds by run", () => {
    assert.deepEqual(release("production", ["v0.2.0"]), { stage: "production", version: "0.3.0" });
    assert.deepEqual(release("staging", ["v0.3.0"]), {
      stage: "staging",
      version: "0.3.0-staging.42",
    });
  });
  it("refuses production versions that do not exceed the latest release tag", () => {
    assert.throws(() => release("production", ["v0.3.0"]), /not higher than the released v0.3.0/);
    assert.throws(() => release("production", ["v0.2.9", "v0.10.0", "v0.4.1"]), /v0.10.0/);
    assert.equal(release("production", ["v0.2.10", "vnext", "v0.3.0-rc.1"]).version, "0.3.0");
    assert.equal(release("production").version, "0.3.0");
  });
  it("fails closed for other branches, stages, invalid versions and run numbers", () => {
    for (const branch of ["dev", "staging", "feature/main", "", undefined])
      for (const stage of ["staging", "production"])
        assert.throws(
          () => releaseIdentity({ branch, stage, packageVersion: "0.3.0", run: "42", tags: [] }),
          /only from main/,
        );
    for (const stage of ["main", "Production", "dev", "", undefined])
      assert.throws(() => release(stage), /staging or production/);
    for (const version of ["0.3", "0.3.0-beta", null]) {
      assert.throws(() => release("production", [], version));
      assert.throws(() => release("staging", [], version));
    }
    for (const run of [undefined, "0", "-1", "1e3"])
      assert.throws(() =>
        releaseIdentity({
          branch: "main",
          stage: "staging",
          packageVersion: "0.3.0",
          run,
          tags: [],
        }),
      );
  });
});
