import { test } from "node:test";
import assert from "node:assert/strict";
import { messageTimeline, stampLabel } from "../src/features/messages/timeline";
import type { Message } from "../src/lib/types";

// Local times, so the expectations hold in any time zone.
const at = (...parts: [number, number, number, number, number]) => new Date(...parts).toISOString();
const message = (id: string, senderId: string, createdAt: string) =>
  ({ id, senderId, createdAt }) as Message;

test("groups consecutive senders into runs and starts a stamped section after an hour", () => {
  const sections = messageTimeline([
    message("1", "bob", at(2026, 9, 13, 9, 0)),
    message("2", "bob", at(2026, 9, 13, 9, 5)),
    message("3", "alice", at(2026, 9, 13, 9, 6)),
    message("4", "bob", at(2026, 9, 13, 10, 6)),
    message("5", "bob", at(2026, 9, 13, 11, 5)),
  ]);
  assert.deepEqual(
    sections.map((section) => section.runs.map((run) => run.messages.map((m) => m.id))),
    [[["1", "2"], ["3"]], [["4", "5"]]],
  );
  assert.equal(sections[0]!.at, at(2026, 9, 13, 9, 0));
  assert.deepEqual(messageTimeline([]), []);
});

test("stamps read like iMessage in the viewer's calendar", () => {
  const now = new Date(2026, 9, 13, 18, 0);
  const label = (...parts: [number, number, number, number, number]) => {
    const stamp = stampLabel(at(...parts), now);
    return stamp.day + " " + stamp.time;
  };
  assert.equal(label(2026, 9, 13, 11, 15), "Today 11:15");
  assert.equal(label(2026, 9, 12, 9, 2), "Yesterday 09:02");
  assert.equal(label(2026, 9, 8, 23, 40), "Thursday 23:40");
  assert.equal(label(2026, 9, 4, 14, 19), "Sun 4 Oct at 14:19");
  assert.equal(label(2025, 11, 30, 8, 0), "30 Dec 2025 at 08:00");
  // A clock slightly ahead of this device still reads as today.
  assert.equal(label(2026, 9, 13, 18, 1), "Today 18:01");
});
