import { drizzle } from "drizzle-orm/pglite";
import { weekFeed } from "./service";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currentWeekStart } from "../../shared/weeks";
import { setupApiTests } from "../../testing/api";
describe("weekly library", () => {
  const api = setupApiTests();
  // Clients cannot backdate links, so fixtures move them into past weeks directly.
  const savedOn = (link: { id: string }, date: string) =>
    api.postgres.query("update links set saved_on = $1 where id = $2", [date, link.id]);
  it("returns own links and visible followed authors with complete per-person pagination", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob"),
      carol = api.client("carol");
    await alice.follows.follow({ userId: "bob" });
    await alice.follows.follow({ userId: "carol" });
    await savedOn(
      await alice.links.create({ url: "https://example.com", title: "Own" }),
      "2026-01-05",
    );
    const group = await bob.groups.create({ name: "Reading" }),
      cg = await carol.groups.create({ name: "Reading" });
    for (const title of ["One", "Two"])
      await savedOn(
        await bob.links.create({ url: "https://example.com", title, groupId: group.id }),
        "2026-01-06",
      );
    const locked = await bob.groups.create({ name: "Locked", visibility: "private" });
    await savedOn(
      await bob.links.create({ url: "https://example.com", title: "Hidden", groupId: locked.id }),
      "2026-01-06",
    );
    await savedOn(
      await carol.links.create({ url: "https://example.com", title: "Three", groupId: cg.id }),
      "2026-01-07",
    );
    const week = await alice.feed.week({ weekStart: "2026-01-05", limit: 1, linkLimit: 1 });
    assert.equal(week.own.items[0]!.title, "Own");
    assert.equal(week.people[0]!.author.id, "bob");
    assert(week.nextAfter);
    const more = await alice.links.listByOwner({
      userId: "bob",
      weekStart: week.weekStart,
      cursor: week.people[0]!.links.nextCursor!,
    });
    assert.equal(more.items.length, 1);
    assert.equal(
      (await alice.feed.week({ weekStart: week.weekStart, after: week.nextAfter! })).people[0]!
        .author.id,
      "carol",
    );
    assert.equal((await alice.feed.week({ weekStart: "2025-12-29" })).people.length, 0);
    await bob.groups.update({ id: group.id, visibility: "private" });
    assert.equal((await alice.feed.week({ weekStart: week.weekStart })).people.length, 1);
    await assert.rejects(alice.feed.week({ weekStart: "2026-01-06" }), { code: "BAD_REQUEST" });
  });
  it("loads a multi-author week in three database round trips", async () => {
    const alice = api.client("alice");
    for (const owner of ["alice", "bob", "carol", "dana"]) {
      if (owner !== "alice") await alice.follows.follow({ userId: owner });
      for (const title of ["First", "Second"])
        await savedOn(
          await api.client(owner).links.create({ title, url: "https://example.com" }),
          "2026-01-05",
        );
    }
    let queries = 0;
    const db = drizzle({
      client: api.postgres,
      logger: {
        logQuery() {
          queries++;
        },
      },
    });
    const result = await weekFeed(db, "alice", {
      weekStart: "2026-01-05",
      limit: 10,
      linkLimit: 1,
    });
    assert(result.isOk());
    assert.equal(result.value.people.length, 3);
    for (const page of [result.value.own, ...result.value.people.map((p) => p.links)]) {
      assert.equal(page.items.length, 1);
      assert(page.nextCursor);
    }
    assert.equal(queries, 3);
  });
  it("steps over weeks where neither you nor your people shared anything", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob"),
      carol = api.client("carol");
    await alice.follows.follow({ userId: "bob" });
    const group = await bob.groups.create({ name: "Reading" });
    const link = (client: typeof alice, groupId?: string) =>
      client.links.create({ url: "https://example.com", title: "Link", groupId });
    await savedOn(await link(alice), "2026-01-07");
    await savedOn(await link(bob, group.id), "2025-12-16");
    // Neither bob's locked group nor carol, whom alice does not follow, count.
    const locked = await bob.groups.create({ name: "Locked", visibility: "private" });
    await savedOn(await link(bob, locked.id), "2025-12-03");
    await savedOn(await link(carol, (await carol.groups.create({ name: "R" })).id), "2025-12-09");
    const january = await alice.feed.week({ weekStart: "2026-01-05" });
    assert.equal(january.olderWeek, "2025-12-15");
    assert.equal(january.newerWeek, currentWeekStart());
    const december = await alice.feed.week({ weekStart: "2025-12-15" });
    assert.equal(december.olderWeek, null);
    assert.equal(december.newerWeek, "2026-01-05");
    const current = await alice.feed.week({ weekStart: currentWeekStart() });
    assert.equal(current.newerWeek, null);
    assert.equal(current.olderWeek, "2026-01-05");
  });
  it("saves links to today and never lets clients move them between weeks", async () => {
    const alice = api.client("alice");
    const input = { url: "https://example.com", title: "Now" };
    const link = await alice.links.create(input);
    assert.equal(link.savedOn, new Date().toISOString().slice(0, 10));
    await assert.rejects(alice.links.create({ ...input, savedOn: "2026-01-05" } as typeof input), {
      code: "BAD_REQUEST",
    });
    await assert.rejects(
      alice.links.update({ id: link.id, savedOn: "2026-01-05" } as { id: string }),
      { code: "BAD_REQUEST" },
    );
  });
  it("enumerates visible ISO weeks across years", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    const group = await alice.groups.create({ name: "Reading" });
    const link = await alice.links.create({
      url: "https://example.com",
      title: "One",
      groupId: group.id,
    });
    await savedOn(link, "2026-01-01");
    await savedOn(
      await alice.links.create({ url: "https://example.com", title: "Two", groupId: group.id }),
      "2026-01-05",
    );
    const locked = await alice.groups.create({ name: "Locked", visibility: "private" });
    await savedOn(
      await alice.links.create({ url: "https://example.com", title: "Hidden", groupId: locked.id }),
      "2025-12-20",
    );
    const first = await bob.links.weeks({ userId: "alice", limit: 1 });
    assert.equal(first.items[0]!.weekStart, "2026-01-05");
    const next = await bob.links.weeks({ userId: "alice", before: first.nextBefore! });
    assert.deepEqual(next.items, [{ weekStart: "2025-12-29", count: 1 }]);
    await savedOn(link, "2025-12-15");
    assert.deepEqual(
      (await alice.links.listMine({ weekStart: "2025-12-15" })).items.map((item) => item.title),
      ["Hidden", "One"],
    );
    await alice.favorites.add({ linkId: link.id });
    const favorites = await alice.favorites.group();
    assert.equal(
      (await bob.links.weeks({ userId: "alice", groupId: favorites.id })).items[0]!.weekStart,
      "2025-12-15",
    );
    await alice.groups.update({ id: group.id, visibility: "private" });
    assert.equal(
      (await bob.links.weeks({ userId: "alice", groupId: favorites.id })).items.length,
      0,
    );
  });
});
