import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileGroup } from "../src/features/groups/selection";
import type { Group } from "../src/lib/types";

test("partial or failed group pages retain selection; completed deletion or revocation makes it unavailable", () => {
  const selected = { id: "selected", name: "Reading", visibility: "public" } as Group;
  assert.deepEqual(reconcileGroup(selected, [], false), { current: selected, unavailable: false });
  const changed = { ...selected, name: "Renamed", visibility: "private" } as Group;
  assert.deepEqual(reconcileGroup(selected, [changed], true), {
    current: changed,
    unavailable: false,
  });
  assert.deepEqual(reconcileGroup(selected, [], true), { current: selected, unavailable: true });
  assert.deepEqual(reconcileGroup(null, [], true), { current: null, unavailable: false });
});
