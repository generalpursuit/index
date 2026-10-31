import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { createTestDatabase } from "../../testing/database";
import * as repo from "./repository";
import { createRouterClient } from "@orpc/server";
import { appRouter } from "../../routers/index";

describe("durable live invalidations", () => {
  let f: Awaited<ReturnType<typeof createTestDatabase>>;
  before(async () => {
    f = await createTestDatabase();
  });
  beforeEach(async () => {
    await f.reset();
    await f.client.exec("TRUNCATE live_changes");
  });
  after(async () => {
    await f.close();
  });
  it("coalesces hints without erasing a concurrent committed update", async () => {
    await f.client.exec("SELECT index_live_changed('alice')");
    const [first] = await repo.changes(f.db);
    await f.client.exec("SELECT index_live_changed('alice')");
    await repo.acknowledge(f.db, first!.userId, first!.version);
    const [latest] = await repo.changes(f.db);
    assert.equal(latest!.userId, "alice");
    assert.notEqual(first!.version, latest!.version);
    await repo.acknowledge(f.db, latest!.userId, latest!.version);
    assert.equal((await repo.changes(f.db)).length, 0);
  });
  it("records account changes without notification registration and rolls hints back atomically", async () => {
    await f.client.exec("UPDATE \"user\" SET name='Updated' WHERE id='alice'");
    assert.equal((await repo.changes(f.db))[0]!.userId, "alice");
    await f.client.exec("TRUNCATE live_changes");
    await f.client.exec("BEGIN; SELECT index_live_changed('bob'); ROLLBACK;");
    assert.deepEqual(await repo.changes(f.db), []);
  });
  it("session revocation survives later ordinary changes", async () => {
    await f.client.exec(
      "SELECT index_live_changed('alice', true); SELECT index_live_changed('alice')",
    );
    assert.equal((await repo.changes(f.db))[0]!.sessionChanged, true);
  });
  it("does not schedule idle desktop deliveries or an empty outbox", async () => {
    assert.equal(await repo.nextDelivery(f.db), undefined);
    const result = await f.db
      .select({ count: sql<number>`count(*)::int` })
      .from(sql`notification_devices`);
    assert.equal(result[0]!.count, 0);
  });
  it("schedules contract mutations once and leaves RPC reads and ticket issuance alone", async () => {
    const order: string[] = [];
    const context = {
      ...f.context("alice"),
      dispatch: async () => {
        order.push("begin");
        return () => {
          order.push("finish");
        };
      },
    };
    const client = createRouterClient(appRouter, { context });
    await client.pulse.get();
    await client.notifications.preferences({});
    assert.deepEqual(order, []);
    await client.notifications.updatePreferences({ message: false });
    assert.deepEqual(order, ["begin", "finish"]);
    await assert.rejects(client.live.ticket(), { code: "NOT_IMPLEMENTED" });
    assert.deepEqual(order, ["begin", "finish"]);
  });
  it("rejects a mutation before changing data when durable recovery cannot be registered", async () => {
    const client = createRouterClient(appRouter, {
      context: {
        ...f.context("alice"),
        dispatch: async () => {
          throw new Error("Scheduler unavailable");
        },
      },
    });
    await assert.rejects(client.notifications.updatePreferences({ message: false }));
    const ordinary = createRouterClient(appRouter, { context: f.context("alice") });
    assert.equal((await ordinary.notifications.preferences({})).message, true);
  });
});
