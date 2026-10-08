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
    await bob.links.create({ title: "Inbox", url: "https://example.com/private" });
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
    await bob.stars.add({ linkId: two.id });
    assert.equal((await alice.feed.list({})).items.length, 2);
    await bob.groups.update({ id: group.id, visibility: "private" });
    assert.equal((await alice.feed.list({ cursor: first.nextCursor! })).items.length, 0);
    await assert.rejects(api.client(null).feed.list({}), { code: "UNAUTHORIZED" });
  });
});
