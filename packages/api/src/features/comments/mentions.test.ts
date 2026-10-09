import assert from "node:assert/strict";
import { it } from "node:test";
import { mentionedUsernames } from "./mentions";

it("recognizes standalone valid handles, normalizes case and deduplicates", () => {
  assert.deepEqual(mentionedUsernames("@Alice (@BOB_12), @alice!\n@carol."), [
    "alice",
    "bob_12",
    "carol",
  ]);
  assert.deepEqual(
    mentionedUsernames("name@alice.com https://site.test/@bob @@carol @ab @" + "x".repeat(31)),
    [],
  );
  assert.deepEqual(mentionedUsernames("é@alice @bobé"), []);
});
