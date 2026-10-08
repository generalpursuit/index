import { links } from "@index/db/schema/app";
import { createRouterClient, ORPCError } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { createTestDatabase } from "../../testing/database";
import { encodeCursor } from "../../pagination";
import { linksRouter } from "./router";

describe("links API with PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  before(async () => {
    fixture = await createTestDatabase();
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  after(async () => {
    await fixture?.close();
  });

  const client = (actor: string | null) =>
    createRouterClient(linksRouter, { context: fixture.context(actor) });
  const input = { url: "https://example.com/read", title: "Read this" };
  const missingId = "00000000-0000-4000-8000-000000000099";

  it("saves to the authenticated user's inbox and reads the persisted result", async () => {
    const saved = await client("alice").create({
      ...input,
      description: "My notes",
      category: "article",
    });
    assert.equal(saved.ownerId, "alice");
    assert.equal(saved.groupId, null);
    assert.equal(saved.category, "article");
    assert.equal(saved.description, "My notes");
    assert.equal(typeof saved.createdAt, "string");
    assert.match(saved.createdAt, /\.\d{6}Z$/);
    assert.deepEqual(await client("alice").get({ id: saved.id }), saved);
    const defaults = await client("alice").create(input);
    assert.equal(defaults.description, null);
    assert.equal(defaults.category, "uncategorized");
  });

  it("requires authentication for saving and listing your library", async () => {
    await assert.rejects(client(null).create(input), { code: "UNAUTHORIZED" });
    await assert.rejects(client(null).listMine({}), { code: "UNAUTHORIZED" });
    await assert.rejects(client(null).get({ id: missingId }), { code: "NOT_FOUND" });
    assert.deepEqual(await fixture.db.select().from(links), []);
  });

  it("makes another user's private link indistinguishable from a missing link", async () => {
    const saved = await client("alice").create(input);
    await assert.rejects(client("bob").get({ id: saved.id }), {
      code: "NOT_FOUND",
      message: "Link not found.",
    });
    await assert.rejects(client("bob").get({ id: missingId }), {
      code: "NOT_FOUND",
      message: "Link not found.",
    });
    assert.deepEqual(await client("bob").listMine({}), { items: [], nextCursor: null });
  });

  it("validates input before writing and prevents ownership injection", async () => {
    for (const invalid of [
      { ...input, title: " " },
      { ...input, ownerId: "bob" },
    ]) {
      await assert.rejects(client("alice").create(invalid), { code: "BAD_REQUEST" });
    }
    assert.deepEqual(await fixture.db.select().from(links), []);
    await assert.rejects(client("alice").get({ id: "invalid" }), { code: "BAD_REQUEST" });
  });

  it("paginates tied and sub-millisecond timestamps without skips or repeats", async () => {
    const id = (number: number) => `00000000-0000-4000-8000-${number.toString().padStart(12, "0")}`;
    const time = (value: string) => sql`${value}::timestamptz`;
    await fixture.db.insert(links).values([
      { ...input, id: id(1), ownerId: "alice", createdAt: time("2026-10-08T10:00:00.123001Z") },
      { ...input, id: id(2), ownerId: "alice", createdAt: time("2026-10-08T10:00:00.123999Z") },
      { ...input, id: id(3), ownerId: "alice", createdAt: time("2026-10-08T10:00:00.123999Z") },
      { ...input, id: id(4), ownerId: "bob", createdAt: time("2026-10-08T10:00:00.124000Z") },
    ]);
    const first = await client("alice").listMine({ limit: 1 });
    assert.deepEqual(
      first.items.map((link) => link.id),
      [id(3)],
    );
    assert.ok(first.nextCursor);
    // A deleted cursor row and a newer insert must not shift the remaining page boundaries.
    await fixture.db.delete(links).where(eq(links.id, id(3)));
    await fixture.db.insert(links).values({
      ...input,
      id: id(5),
      ownerId: "alice",
      createdAt: time("2026-10-08T11:00:00.000000Z"),
    });
    const second = await client("alice").listMine({ limit: 1, cursor: first.nextCursor });
    assert.deepEqual(
      second.items.map((link) => link.id),
      [id(2)],
    );
    assert.ok(second.nextCursor);
    const third = await client("alice").listMine({ limit: 1, cursor: second.nextCursor });
    assert.deepEqual(
      third.items.map((link) => link.id),
      [id(1)],
    );
    assert.equal(third.nextCursor, null);
  });

  it("cannot use another user's cursor to bypass ownership filtering", async () => {
    const own = await client("bob").create(input);
    const other = await client("alice").create(input);
    await fixture.db
      .update(links)
      .set({ createdAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(links.id, own.id));
    const page = await client("bob").listMine({ cursor: encodeCursor(other) });
    assert.deepEqual(
      page.items.map((link) => link.id),
      [own.id],
    );
  });

  it("returns a typed error for malformed cursors", async () => {
    await assert.rejects(client("alice").listMine({ cursor: "garbage" }), {
      code: "BAD_REQUEST",
      message: "Invalid cursor.",
    });
  });

  it("does not expose database failures to clients", async () => {
    await assert.rejects(client("deleted-user").create(input), (error: unknown) => {
      assert.ok(error instanceof ORPCError);
      assert.equal(error.code, "INTERNAL_SERVER_ERROR");
      assert.equal(error.message, "Something went wrong.");
      assert.ok(error.cause);
      return true;
    });
  });
});
