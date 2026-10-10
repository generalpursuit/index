import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupApiTests } from "../../testing/api";

describe("group privacy changes", () => {
  const api = setupApiTests();
  it("locking revokes access and unlocking still respects a private profile", async () => {
    const owner = api.client("alice"),
      follower = api.client("bob"),
      stranger = api.client("carol");
    await owner.profiles.update({ profileVisibility: "private" });
    await follower.follows.follow({ userId: "alice" });
    await owner.follows.accept({ userId: "bob" });
    const group = await owner.groups.create({ name: "Selection" });
    const link = await owner.links.create({
      url: "https://example.com/selection",
      title: "Selection",
      groupId: group.id,
    });
    for (const visibility of ["public", "private", "public"] as const) {
      await owner.groups.update({ id: group.id, visibility });
      assert.equal((await owner.groups.get({ id: group.id })).visibility, visibility);
      if (visibility === "public") {
        assert.equal((await follower.links.get({ id: link.id })).id, link.id);
      } else {
        await assert.rejects(follower.links.get({ id: link.id }), { code: "NOT_FOUND" });
        await assert.rejects(follower.groups.get({ id: group.id }), { code: "NOT_FOUND" });
      }
      for (const viewer of [stranger, api.client(null)]) {
        await assert.rejects(viewer.groups.get({ id: group.id }), { code: "NOT_FOUND" });
        await assert.rejects(viewer.links.get({ id: link.id }), { code: "NOT_FOUND" });
      }
      await assert.rejects(follower.groups.update({ id: group.id, visibility: "public" }), {
        code: "NOT_FOUND",
      });
    }
  });
});
