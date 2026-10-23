import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { user } from "@index/db/schema/auth";
import { eq } from "drizzle-orm";
import { setupApiTests } from "../../testing/api";

describe("discovery", () => {
  const api = setupApiTests();

  it("excludes undiscoverable accounts before search pagination while retaining unverified people", async () => {
    await api.client("alice").profiles.update({ name: "Reader one", profileVisibility: "private" });
    await api.client("bob").profiles.update({ name: "Reader two" });
    await api.db.update(user).set({ emailVerified: false }).where(eq(user.id, "bob"));
    await api.db.insert(user).values([
      { id: "a-test", name: "Reader test", email: "test@example.com", isDiscoverable: false },
      { id: "az-test", name: "Reader probe", email: "probe@example.com", isDiscoverable: false },
    ]);
    for (const viewer of [null, "alice"]) {
      const discovery = api.client(viewer).discovery;
      const first = await discovery.searchUsers({ query: "Reader", limit: 1 });
      assert.deepEqual(
        first.items.map((item) => item.id),
        ["alice"],
      );
      assert.equal(first.nextAfter, "alice");
      assert.equal("isDiscoverable" in first.items[0]!, false);
      const second = await discovery.searchUsers({
        query: "Reader",
        limit: 1,
        after: first.nextAfter!,
      });
      assert.deepEqual(
        second.items.map((item) => item.id),
        ["bob"],
      );
      assert.equal(second.nextAfter, null);
      assert.deepEqual(await discovery.searchUsers({ query: "Reader test" }), {
        items: [],
        nextAfter: null,
      });
    }
    // Hidden review accounts can still use their profiles and existing direct links.
    assert.equal((await api.client("a-test").profiles.get({ userId: "a-test" })).id, "a-test");
  });

  it("excludes hidden suggestions and recommenders before ranking and mutual-follow counts", async () => {
    await api.db.insert(user).values([
      { id: "a-test", name: "Test target", email: "target@example.com", isDiscoverable: false },
      { id: "b-test", name: "Test source", email: "source@example.com", isDiscoverable: false },
    ]);
    const alice = api.client("alice");
    for (const id of ["bob", "b-test"]) {
      await alice.follows.follow({ userId: id });
      await api.client(id).follows.follow({ userId: "dana" });
    }
    await api.client("bob").follows.follow({ userId: "a-test" });
    await api.client("b-test").follows.follow({ userId: "carol" });
    const { items } = await alice.discovery.recommendations({ limit: 1 });
    assert.deepEqual(
      items.map((item) => item.id),
      ["dana"],
    );
    assert.deepEqual(
      items[0]?.followedBy.users.map((person) => person.id),
      ["bob"],
    );
    assert.equal(items[0]?.followedBy.total, 1);
    assert.deepEqual((await alice.discovery.recommendations({})).items, items);
    assert.deepEqual(
      (await alice.discovery.searchUsers({ query: "dana" })).items[0]?.followedBy,
      items[0]?.followedBy,
    );
    assert.deepEqual(
      (await alice.profiles.get({ userId: "dana" })).followedBy,
      items[0]?.followedBy,
    );
  });
  it("includes the viewer's follow state without exposing another viewer's relationship", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    await bob.profiles.update({ profileVisibility: "private" });
    await alice.follows.follow({ userId: "bob" });
    assert.equal(
      (await alice.discovery.searchUsers({ query: "bob" })).items[0]?.followingStatus,
      "pending",
    );
    assert.equal(
      (await api.client(null).discovery.searchUsers({ query: "bob" })).items[0]?.followingStatus,
      null,
    );
    await bob.follows.accept({ userId: "alice" });
    assert.equal(
      (await alice.discovery.searchUsers({ query: "bob" })).items[0]?.followingStatus,
      "accepted",
    );
    assert.equal(
      (await api.client("carol").discovery.searchUsers({ query: "bob" })).items[0]?.followingStatus,
      null,
    );
  });
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
