import assert from "node:assert/strict";
import { test } from "node:test";
import { OutboxSchedule, type ScheduleStorage } from "./schedule";

function fixture() {
  let now = 1_000_000;
  let alarm: number | null = null;
  const values = new Map<string, unknown>();
  let serial = Promise.resolve();
  const storage: ScheduleStorage = {
    transaction(run) {
      const result = serial.then(() =>
        run({
          get: async <T>(key: string) => structuredClone(values.get(key)) as T | undefined,
          put: async (key, value) => {
            values.set(key, structuredClone(value));
          },
          getAlarm: async () => alarm,
          setAlarm: async (at) => {
            alarm = at;
          },
          deleteAlarm: async () => {
            alarm = null;
          },
        }),
      );
      serial = result.then(
        () => {},
        () => {},
      );
      return result;
    },
  };
  const clock = new OutboxSchedule(storage, () => now);
  return {
    clock,
    alarm: () => alarm,
    advance: (ms: number) => {
      now += ms;
    },
    async fire(drain: () => Promise<number | undefined>) {
      alarm = null;
      await clock.run(drain);
    },
  };
}
test("an ordinary write drains once then leaves no alarm or database polling", async () => {
  const f = fixture();
  await f.clock.begin("write");
  assert.equal(f.alarm(), 1_120_000);
  await f.clock.finish("write");
  assert.equal(f.alarm(), 1_000_000);
  await f.fire(async () => undefined);
  assert.equal(f.alarm(), null);
});
test("a response lost after commit retains its pre-registered recovery wake", async () => {
  const f = fixture();
  await f.clock.begin("interrupted");
  f.advance(120_000);
  let drains = 0;
  await f.fire(async () => {
    drains++;
    return undefined;
  });
  assert.equal(drains, 1);
  assert.equal(f.alarm(), null);
});
test("a completed write during a drain cannot be erased by a stale empty result", async () => {
  const f = fixture();
  await f.clock.finish();
  await f.fire(async () => {
    await f.clock.begin("concurrent");
    f.advance(30_000); // Exactly the fallback alarm's timestamp.
    await f.clock.finish("concurrent");
    return undefined;
  });
  assert.equal(f.alarm(), 1_030_000);
  await f.fire(async () => undefined);
  assert.equal(f.alarm(), null);
});
test("a still-running concurrent write keeps its recovery alarm", async () => {
  const f = fixture();
  await f.fire(async () => {
    await f.clock.begin("running");
    return undefined;
  });
  assert.equal(f.alarm(), 1_120_000);
});
test("failed drains persist a retry before I/O and use bounded backoff", async () => {
  const f = fixture();
  for (let i = 0; i < 9; i++) {
    const before = f.alarm();
    if (before !== null)
      f.advance(i === 0 ? 0 : Math.min(900_000, 30_000 * 2 ** Math.min(i - 1, 5)));
    await assert.rejects(
      f.fire(async () => {
        assert.notEqual(f.alarm(), null);
        throw new Error("Interrupted");
      }),
    );
  }
  await f.fire(async () => undefined);
  assert.equal(f.alarm(), null);
});
test("a provider retry schedules its deadline without periodic checks", async () => {
  const f = fixture();
  await f.fire(async () => 4_600_000);
  assert.equal(f.alarm(), 4_600_000);
});
