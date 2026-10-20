import { test } from "node:test";
import assert from "node:assert/strict";
import { weekLabel, weekNumber, yearMarks } from "../src/lib/weeks";

test("numbers a week by its Thursday, across the turn of a year", () => {
  assert.equal(weekNumber("2025-12-29"), 1);
  assert.equal(weekNumber("2026-10-19"), 43);
  assert.equal(weekLabel("2025-12-29"), "Week 1");
});

test("marks the first listed week of each new year", () => {
  // Newest first. A week belongs to its Thursday's year: 29 Dec 2025 is Week 1 of 2026.
  assert.deepEqual(
    yearMarks(["2026-02-09", "2026-01-12", "2025-12-29", "2025-12-22", "2024-12-30", "2024-12-23"]),
    [null, null, "2026", null, "2025", null],
  );
  assert.deepEqual(yearMarks([]), []);
});
