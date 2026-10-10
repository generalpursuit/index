import { stars } from "@index/db/schema/app";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupApiTests } from "../../testing/api";

describe("starred references", () => {
  const api = setupApiTests();
  it("stars the original once and hides it when original access is revoked", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    const group = await alice.groups.create({ name: "Reading" });
    const link = await alice.links.create({
      title: "Original",
      url: "https://example.com",
      groupId: group.id,
    });
    await bob.stars.add({ linkId: link.id });
    await bob.stars.add({ linkId: link.id });
    assert.equal((await api.db.select().from(stars)).length, 1);
    assert.equal((await bob.stars.list({})).items[0]?.ownerId, "alice");
    const starred = await bob.stars.group();
    await assert.rejects(api.client(null).links.listInGroup({ groupId: starred.id }), {
      code: "NOT_FOUND",
    });
    await alice.links.update({ id: link.id, title: "Updated original" });
    assert.equal((await bob.stars.list({})).items[0]?.title, "Updated original");
    await alice.groups.update({ id: group.id, visibility: "private" });
    assert.equal((await bob.stars.list({})).items.length, 0);
    await assert.rejects(api.client(null).links.listInGroup({ groupId: starred.id }), {
      code: "NOT_FOUND",
    });
    await assert.rejects(bob.stars.add({ linkId: link.id }), { code: "NOT_FOUND" });
    // Even the original owner cannot bypass the starring group's visibility.
    await bob.groups.update({ id: starred.id, visibility: "private" });
    await assert.rejects(alice.links.listInGroup({ groupId: starred.id }), { code: "NOT_FOUND" });
    await bob.stars.remove({ linkId: link.id });
    await bob.stars.remove({ linkId: link.id });
    assert.equal((await api.db.select().from(stars)).length, 0);
  });

  it("does not disclose a follower-only original through someone else's public Starred", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    await alice.profiles.update({ profileVisibility: "private" });
    const group = await alice.groups.create({ name: "Friends" });
    const link = await alice.links.create({
      title: "Private profile",
      url: "https://example.com",
      groupId: group.id,
    });
    await bob.follows.follow({ userId: "alice" });
    await alice.follows.accept({ userId: "bob" });
    await bob.stars.add({ linkId: link.id });
    const starred = await bob.stars.group();
    assert.equal((await bob.stars.list({})).items.length, 1);
    await assert.rejects(api.client("carol").links.listInGroup({ groupId: starred.id }), {
      code: "NOT_FOUND",
    });
    await alice.follows.removeFollower({ userId: "bob" });
    assert.equal((await bob.stars.list({})).items.length, 0);
    assert.equal((await api.db.select().from(stars)).length, 1);
  });
});
