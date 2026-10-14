import { test } from "node:test";
import assert from "node:assert/strict";
import { createPulseDriver, mergeNewestPage, type Pulse } from "../src/data/pulse";
const pulse = (messages = "m1", activity = "a1"): Pulse => ({
  messages: { unreadCount: 2, version: messages },
  activity: { unreadCount: 3, version: activity },
});
test("pulse skips hidden windows and unchanged lists, and resumes on focus", async () => {
  let shown = true,
    answer = pulse(),
    requests = 0;
  const changes: boolean[][] = [];
  const driver = createPulseDriver({
    visible: () => shown,
    focusedConversation: () => false,
    request: async () => {
      requests++;
      return answer;
    },
    changed: (_pulse, messages, activity) => {
      changes.push([messages, activity]);
    },
  });
  await driver.tick();
  await driver.tick();
  shown = false;
  await driver.tick();
  assert.equal(requests, 2);
  shown = true;
  answer = pulse("m2");
  await driver.tick();
  driver.stop();
  await driver.tick();
  assert.deepEqual(changes, [
    [true, true],
    [false, false],
    [true, false],
  ]);
  assert.equal(requests, 3);
});
test("overlapping pulse triggers share one request and account disposal drops a late answer", async () => {
  let resolve!: (value: Pulse) => void,
    requests = 0,
    changed = false;
  const promise = new Promise<Pulse>((done) => {
    resolve = done;
  });
  const driver = createPulseDriver({
    visible: () => true,
    focusedConversation: () => true,
    request: () => {
      requests++;
      return promise;
    },
    changed: () => {
      changed = true;
    },
  });
  const first = driver.tick(),
    second = driver.tick();
  assert.equal(first, second);
  assert.equal(requests, 1);
  driver.stop();
  resolve(pulse());
  await first;
  assert.equal(changed, false);
});
test("newest-page refresh keeps loaded history and never duplicates an overlapping message", () => {
  const item = (id: string, createdAt: string) => ({ id, createdAt });
  const current = {
    pages: [
      { items: [item("b", "2"), item("a", "1")], nextCursor: "a" },
      { items: [item("older", "0")], nextCursor: null },
    ],
    pageParams: [undefined, "a"],
  };
  const merged = mergeNewestPage(current, {
    items: [item("new", "3"), item("b", "2")],
    nextCursor: "b",
  });
  assert.deepEqual(
    merged.pages.flatMap((page) => page.items.map((message) => message.id)),
    ["new", "b", "a", "older"],
  );
  assert.deepEqual(merged.pageParams, current.pageParams);
  assert.equal(merged.pages[0]!.nextCursor, "a");
});

test("newest-page refresh preserves the cursor's ID tie-breaker when messages share a timestamp", () => {
  const item = (id: string) => ({ id, createdAt: "2026-10-14T12:00:00.000Z" });
  const current = {
    pages: [{ items: [item("b"), item("a")], nextCursor: "a" }],
    pageParams: [undefined],
  };
  const merged = mergeNewestPage(current, {
    items: [item("c"), item("b")],
    nextCursor: "b",
  });
  assert.deepEqual(
    merged.pages[0]!.items.map((message) => message.id),
    ["c", "b", "a"],
  );
  assert.equal(merged.pages[0]!.nextCursor, "a");
});

for (const ordering of ["createdAt", "updatedAt"] as const) {
  test(`disconnected ${ordering} pages restart at the newest cursor without skipping arrivals`, () => {
    const item = (id: string, at: string) => ({ id, [ordering]: at });
    const current = {
      pages: [
        { items: [item("c", "3"), item("b", "2")], nextCursor: "b" },
        { items: [item("a", "1")], nextCursor: null },
      ],
      pageParams: [undefined, "b"],
    };
    const newest = { items: [item("g", "7"), item("f", "6")], nextCursor: "f" };
    assert.deepEqual(mergeNewestPage(current, newest), {
      pages: [newest],
      pageParams: [undefined],
    });
    const full = { ...newest, nextCursor: null };
    assert.deepEqual(mergeNewestPage(current, full), { pages: [full], pageParams: [undefined] });
  });
}
