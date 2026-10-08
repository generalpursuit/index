import { follows } from "@index/db/schema/app";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupApiTests } from "../../testing/api";

describe("following and follow requests", () => {
  const api = setupApiTests();

  it("records directed relationships independently and handles retries", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    assert.deepEqual(await alice.follows.follow({ userId: "bob" }), { status: "accepted" });
    await alice.follows.follow({ userId: "bob" });
    assert.equal((await bob.follows.following({ userId: "bob" })).items.length, 0);
    assert.equal((await bob.follows.followers({ userId: "bob" })).items[0]?.id, "alice");
    await bob.follows.follow({ userId: "alice" });
    assert.equal((await api.db.select().from(follows)).length, 2);
    await alice.follows.unfollow({ userId: "bob" });
    await alice.follows.unfollow({ userId: "bob" });
    assert.deepEqual(
      (await api.db.select().from(follows)).map((row) => [row.followerId, row.followedId]),
      [["bob", "alice"]],
    );
    await assert.rejects(alice.follows.follow({ userId: "alice" }), { code: "BAD_REQUEST" });
    await assert.rejects(alice.follows.follow({ userId: "missing" }), { code: "NOT_FOUND" });
  });

  it("requires acceptance for private profiles and immediately revokes access on removal", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    await alice.profiles.update({ profileVisibility: "private" });
    const group = await alice.groups.create({ name: "Followers" });
    const link = await alice.links.create({
      title: "Read",
      url: "https://example.com",
      groupId: group.id,
    });
    assert.equal((await bob.follows.follow({ userId: "alice" })).status, "pending");
    assert.equal((await alice.follows.requests({})).items[0]?.id, "bob");
    await assert.rejects(bob.links.get({ id: link.id }), { code: "NOT_FOUND" });
    await assert.rejects(bob.follows.followers({ userId: "alice" }), { code: "NOT_FOUND" });
    await assert.rejects(api.client("carol").follows.accept({ userId: "bob" }), {
      code: "NOT_FOUND",
    });
    await alice.follows.accept({ userId: "bob" });
    assert.equal((await bob.links.get({ id: link.id })).id, link.id);
    assert.equal((await bob.follows.follow({ userId: "alice" })).status, "accepted");
    await alice.follows.reject({ userId: "bob" });
    assert.equal((await bob.profiles.get({ userId: "alice" })).followingStatus, "accepted");
    await alice.follows.removeFollower({ userId: "bob" });
    await assert.rejects(bob.links.get({ id: link.id }), { code: "NOT_FOUND" });
  });

  it("rejects or cancels pending requests and accepts remaining requests on publication", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    await alice.profiles.update({ profileVisibility: "private" });
    await bob.follows.follow({ userId: "alice" });
    await alice.follows.reject({ userId: "bob" });
    assert.equal((await bob.profiles.get({ userId: "alice" })).followingStatus, null);
    await bob.follows.follow({ userId: "alice" });
    await bob.follows.unfollow({ userId: "alice" });
    assert.equal((await alice.follows.requests({})).items.length, 0);
    await bob.follows.follow({ userId: "alice" });
    await alice.profiles.update({ profileVisibility: "public" });
    assert.equal((await bob.profiles.get({ userId: "alice" })).followingStatus, "accepted");
    await alice.profiles.update({ profileVisibility: "private" });
    assert.equal((await bob.profiles.get({ userId: "alice" })).canViewContent, true);
  });

  it("paginates followers and keeps pending requests out of public lists", async () => {
    const alice = api.client("alice");
    for (const id of ["bob", "carol", "dana"])
      await api.client(id).follows.follow({ userId: "alice" });
    const first = await alice.follows.followers({ userId: "alice", limit: 2 });
    assert.deepEqual(
      first.items.map((item) => item.id),
      ["bob", "carol"],
    );
    assert.deepEqual(
      (
        await alice.follows.followers({ userId: "alice", limit: 2, after: first.nextAfter! })
      ).items.map((item) => item.id),
      ["dana"],
    );
    await assert.rejects(api.client(null).follows.requests({}), { code: "UNAUTHORIZED" });
  });
});
