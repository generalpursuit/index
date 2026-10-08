import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupApiTests } from "../../testing/api";
describe("weekly library", () => {
  const api = setupApiTests();
  it("returns own inbox and visible followed authors with complete per-person pagination", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob"),
      carol = api.client("carol");
    await alice.follows.follow({ userId: "bob" });
    await alice.follows.follow({ userId: "carol" });
    await alice.links.create({ url: "https://example.com", title: "Own", savedOn: "2026-01-05" });
    const group = await bob.groups.create({ name: "Reading" }),
      cg = await carol.groups.create({ name: "Reading" });
    for (const title of ["One", "Two"])
      await bob.links.create({
        url: "https://example.com",
        title,
        groupId: group.id,
        savedOn: "2026-01-06",
      });
    await bob.links.create({ url: "https://example.com", title: "Hidden", savedOn: "2026-01-06" });
    await carol.links.create({
      url: "https://example.com",
      title: "Three",
      groupId: cg.id,
      savedOn: "2026-01-07",
    });
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
    await assert.rejects(
      alice.links.create({ url: "https://example.com", title: "Future", savedOn: "2999-01-01" }),
      { code: "BAD_REQUEST" },
    );
  });
  it("enumerates visible ISO weeks across years and preserves creation timestamps on backdating", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    const group = await alice.groups.create({ name: "Reading" });
    const link = await alice.links.create({
      url: "https://example.com",
      title: "One",
      groupId: group.id,
      savedOn: "2026-01-01",
    });
    await alice.links.create({
      url: "https://example.com",
      title: "Two",
      groupId: group.id,
      savedOn: "2026-01-05",
    });
    await alice.links.create({
      url: "https://example.com",
      title: "Hidden",
      savedOn: "2025-12-20",
    });
    const first = await bob.links.weeks({ userId: "alice", limit: 1 });
    assert.equal(first.items[0]!.weekStart, "2026-01-05");
    const next = await bob.links.weeks({ userId: "alice", before: first.nextBefore! });
    assert.deepEqual(next.items, [{ weekStart: "2025-12-29", count: 1 }]);
    const updated = await alice.links.update({ id: link.id, savedOn: "2025-12-15" });
    assert.equal(updated.createdAt, link.createdAt);
    assert.equal(
      (await alice.links.listMine({ weekStart: "2025-12-15", inbox: true })).items[0]!.title,
      "Hidden",
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
