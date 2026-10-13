import { expect, test } from "bun:test";
import { stapleApp } from "./staple.ts";

test("stapling retries until Apple publishes the ticket", () => {
  const calls: string[] = [],
    waits: number[] = [];
  let published = false;
  stapleApp(
    "Index.app",
    6,
    (ms) => {
      waits.push(ms);
      if (waits.length === 2) published = true;
    },
    (command) => (calls.push(command), command === "staple" && published ? 0 : 65),
  );
  expect(calls).toEqual(["validate", "staple", "validate", "staple", "validate", "staple"]);
  expect(waits).toEqual([15_000, 30_000]);
});

test("an already stapled app is left alone", () => {
  const calls: string[] = [];
  stapleApp(
    "Index.app",
    6,
    () => {},
    (command) => (calls.push(command), 0),
  );
  expect(calls).toEqual(["validate"]);
});

test("stapling gives up after its attempts", () => {
  expect(() =>
    stapleApp(
      "Index.app",
      3,
      () => {},
      () => 65,
    ),
  ).toThrow(/Could not staple/);
});
