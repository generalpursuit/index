import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupApiTests } from "../../testing/api";
describe("Favorites and profile privacy", () => {
  const api = setupApiTests();
  it("separates self favorites from other people's stars and preserves original groups", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    const group = await alice.groups.create({ name: "Reading" });
    const link = await alice.links.create({
      url: "https://example.com",
      title: "Own",
      groupId: group.id,
    });
    await assert.rejects(alice.stars.add({ linkId: link.id }), { code: "NOT_FOUND" });
    await assert.rejects(bob.favorites.add({ linkId: link.id }), { code: "NOT_FOUND" });
    await bob.stars.add({ linkId: link.id });
    assert.equal((await bob.links.get({ id: link.id })).isStarred, true);
    await alice.favorites.add({ linkId: link.id });
    await alice.favorites.add({ linkId: link.id });
    assert.equal((await alice.favorites.list({})).items.length, 1);
    assert.equal(
      (await alice.groups.list({})).items.some((g) => g.kind === "favorites"),
      false,
    );
    assert.equal((await alice.links.get({ id: link.id })).groupId, group.id);
    assert.equal((await alice.links.get({ id: link.id })).isFavorite, true);
    assert.equal((await alice.links.update({ id: link.id, title: "Updated" })).isFavorite, true);
    const favorites = await alice.favorites.group();
    assert.equal(
      (await alice.groups.list({ includeFavorites: true })).items.filter(
        (g) => g.kind === "favorites",
      ).length,
      1,
    );
    await assert.rejects(alice.groups.delete({ id: favorites.id }), { code: "NOT_FOUND" });
    await assert.rejects(alice.groups.update({ id: favorites.id, name: "Rename" }), {
      code: "NOT_FOUND",
    });
    assert.equal((await bob.links.listInGroup({ groupId: favorites.id })).items.length, 1);
    await alice.groups.update({ id: group.id, visibility: "private" });
    assert.equal((await bob.links.listInGroup({ groupId: favorites.id })).items.length, 0);
    await alice.favorites.remove({ linkId: link.id });
    assert.equal((await alice.favorites.list({})).items.length, 0);
  });
  it("keeps graph lists and counts owner-only and provides limited mutual context", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob"),
      carol = api.client("carol");
    await alice.follows.follow({ userId: "bob" });
    await bob.follows.follow({ userId: "carol" });
    const profile = await alice.profiles.get({ userId: "carol" });
    assert.equal(profile.followerCount, null);
    assert.equal(profile.followingCount, null);
    assert.equal(profile.followedBy.total, 1);
    assert.equal(profile.followedBy.users[0]!.id, "bob");
    assert.equal((await carol.profiles.me()).followerCount, 1);
    await assert.rejects(alice.follows.followers({ userId: "carol" }), { code: "NOT_FOUND" });
    await assert.rejects(api.client(null).follows.followers({ userId: "carol" }), {
      code: "NOT_FOUND",
    });
    await carol.profiles.update({ profileVisibility: "private" });
    assert.equal((await alice.profiles.get({ userId: "carol" })).linkCount, null);
  });
});
