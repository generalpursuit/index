import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { user } from "@index/db/schema/auth";
import { setupApiTests } from "../../testing/api";

describe("discovery", () => {
  const api = setupApiTests();
  it("names who you follow that follows a suggestion, and excludes self", async () => {
    await api.db.insert(user).values([
      { id: "erin", name: "Erin", email: "erin@example.com" },
      { id: "frank", name: "Frank", email: "frank@example.com" },
    ]);
    const alice = api.client("alice");
    for (const id of ["bob", "carol", "erin"]) {
      await alice.follows.follow({ userId: id });
      await api.client(id).follows.follow({ userId: "dana" });
      await api.client(id).follows.follow({ userId: "alice" });
    }
    await api.client("bob").follows.follow({ userId: "frank" });
    const followedBy = (item: {
      id: string;
      followedBy: { users: { id: string }[]; total: number };
    }) => [item.id, item.followedBy.users.map((person) => person.id), item.followedBy.total];
    // Most shared first; two names at most, with the total beside them.
    assert.deepEqual((await alice.discovery.recommendations({})).items.map(followedBy), [
      ["dana", ["bob", "carol"], 3],
      ["frank", ["bob"], 1],
    ]);
    // Search says the same for signed-in readers, and nothing for guests.
    assert.deepEqual((await alice.discovery.searchUsers({ query: "dana" })).items.map(followedBy), [
      ["dana", ["bob", "carol"], 3],
    ]);
    assert.deepEqual(
      (await api.client(null).discovery.searchUsers({ query: "dana" })).items.map(followedBy),
      [["dana", [], 0]],
    );
  });
  it("searches public identity, including private profiles, with literal search and pagination", async () => {
    await api.client("alice").profiles.update({
      name: "Reader one",
      username: "reader_one",
      profileVisibility: "private",
    });
    await api.client("bob").profiles.update({ name: "Reader two", username: "reader_two" });
    const first = await api.client(null).discovery.searchUsers({ query: "READER", limit: 1 });
    assert.equal(first.items[0]?.id, "alice");
    assert.equal("email" in first.items[0]!, false);
    assert.equal(
      (
        await api
          .client(null)
          .discovery.searchUsers({ query: "reader", after: first.nextAfter!, limit: 1 })
      ).items[0]?.id,
      "bob",
    );
    assert.equal((await api.client(null).discovery.searchUsers({ query: "%" })).items.length, 0);
    assert.equal(
      (await api.client(null).discovery.searchUsers({ query: "reader_" })).items.length,
      2,
    );
  });

  it("recommends second-degree users and excludes self, existing follows and pending requests", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob"),
      carol = api.client("carol");
    await bob.profiles.update({ profileVisibility: "private" });
    await alice.follows.follow({ userId: "bob" });
    await bob.follows.follow({ userId: "carol" });
    assert.equal((await alice.discovery.recommendations({})).items.length, 0);
    await bob.follows.accept({ userId: "alice" });
    assert.deepEqual(
      (await alice.discovery.recommendations({})).items.map((item) => [
        item.id,
        item.followedBy.total,
      ]),
      [["carol", 1]],
    );
    await carol.profiles.update({ profileVisibility: "private" });
    await alice.follows.follow({ userId: "carol" });
    assert.equal((await alice.discovery.recommendations({})).items.length, 0);
    await alice.follows.unfollow({ userId: "carol" });
    await bob.follows.removeFollower({ userId: "alice" });
    assert.equal((await alice.discovery.recommendations({})).items.length, 0);
    await assert.rejects(api.client(null).discovery.recommendations({}), { code: "UNAUTHORIZED" });
  });
});
