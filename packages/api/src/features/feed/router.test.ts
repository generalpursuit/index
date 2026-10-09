import { links } from "@index/db/schema/app";
import { eq, sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupApiTests } from "../../testing/api";

describe("home feed", () => {
  const api = setupApiTests();
  it("shows original saves from accepted followees and rechecks access on every page", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob"),
      carol = api.client("carol");
    const group = await bob.groups.create({ name: "Public" });
    const one = await bob.links.create({
      title: "One",
      url: "https://example.com/1",
      groupId: group.id,
    });
    const two = await bob.links.create({
      title: "Two",
      url: "https://example.com/2",
      groupId: group.id,
    });
    await api.db
      .update(links)
      .set({ createdAt: sql`'2026-01-01T00:00:00.000001Z'::timestamptz` })
      .where(eq(links.id, one.id));
    await api.db
      .update(links)
      .set({ createdAt: sql`'2026-01-01T00:00:00.000999Z'::timestamptz` })
      .where(eq(links.id, two.id));
    const hidden = await bob.groups.create({ name: "Private", visibility: "private" });
    await bob.links.create({
      title: "Hidden",
      url: "https://example.com/hidden",
      groupId: hidden.id,
    });
    await alice.follows.follow({ userId: "bob" });
    const first = await alice.feed.list({ limit: 1 });
    assert.equal(first.items[0]?.id, two.id);
    assert.equal(first.items[0]?.author.id, "bob");
    assert.equal("email" in first.items[0]!.author, false);
    assert.equal(
      (await alice.feed.list({ limit: 1, cursor: first.nextCursor! })).items[0]?.id,
      one.id,
    );
    await carol.profiles.update({ profileVisibility: "private" });
    const otherGroup = await carol.groups.create({ name: "Followers" });
    await carol.links.create({
      title: "Pending",
      url: "https://example.com/pending",
      groupId: otherGroup.id,
    });
    await alice.follows.follow({ userId: "carol" });
    await bob.favorites.add({ linkId: two.id });
    assert.equal((await alice.feed.list({})).items.length, 2);
    await bob.groups.update({ id: group.id, visibility: "private" });
    assert.equal((await alice.feed.list({ cursor: first.nextCursor! })).items.length, 0);
    await assert.rejects(api.client(null).feed.list({}), { code: "UNAUTHORIZED" });
  });

  it("lists the weeks with links from you or people you follow, newest first", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    const mine = await alice.links.create({ title: "Mine", url: "https://example.com/mine" });
    const theirs = await bob.links.create({ title: "Theirs", url: "https://example.com/theirs" });
    const stranger = await api.client("carol").links.create({
      title: "Stranger",
      url: "https://example.com/stranger",
    });
    await api.db.update(links).set({ savedOn: "2026-03-04" }).where(eq(links.id, mine.id));
    await api.db.update(links).set({ savedOn: "2026-02-11" }).where(eq(links.id, theirs.id));
    await api.db.update(links).set({ savedOn: "2026-01-14" }).where(eq(links.id, stranger.id));
    // Nobody followed yet: only your own week.
    assert.deepEqual((await alice.feed.weeks({})).items, [{ weekStart: "2026-03-02", count: 1 }]);
    await alice.follows.follow({ userId: "bob" });
    const all = await alice.feed.weeks({});
    assert.deepEqual(all.items, [
      { weekStart: "2026-03-02", count: 1 },
      { weekStart: "2026-02-09", count: 1 },
    ]);
    const first = await alice.feed.weeks({ limit: 1 });
    assert.equal(first.nextBefore, "2026-03-02");
    assert.deepEqual(
      (await alice.feed.weeks({ limit: 1, before: first.nextBefore! })).items.map(
        (w) => w.weekStart,
      ),
      ["2026-02-09"],
    );
    await assert.rejects(api.client(null).feed.weeks({}), { code: "UNAUTHORIZED" });
  });
});
