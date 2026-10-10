import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ShareAttempt } from "../src/features/sharing/share-attempt";

test("share retries keep identity, explicit duplicates and account/payload changes do not", () => {
  const attempt = new ShareAttempt();
  const initial = attempt.request("https://example.test", null, 1);
  assert.deepEqual(attempt.request(initial.url, null, 1), initial);
  const again = attempt.request(initial.url, null, 1, true);
  assert.notEqual(again.requestId, initial.requestId);
  assert.deepEqual(attempt.request(initial.url, null, 1, true), again);
  const group = attempt.request(initial.url, "00000000-0000-4000-8000-000000000001", 1, true);
  assert.notEqual(group.requestId, again.requestId);
  assert.notEqual(attempt.request(initial.url, group.groupId, 2, true).requestId, group.requestId);
  attempt.complete();
  assert.notEqual(attempt.request(initial.url, null, 1).requestId, initial.requestId);
});

// Build-time normalization must not scope the host and extension to different credentials.
test("build URL scopes match the Swift and Rust bridge fixtures", async () => {
  const { apiScope } = await import("../scripts/api-scope.mjs");
  const cases = JSON.parse(
    await readFile(
      new URL("../../ios/Tests/IndexCoreTests/Fixtures/api-scopes.json", import.meta.url),
      "utf8",
    ),
  );
  for (const entry of cases) {
    if (entry.output === null) assert.throws(() => apiScope(entry.input));
    else assert.equal(apiScope(entry.input), entry.output);
  }
});
