import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupApiTests } from "../../testing/api";

describe("comments", () => {
  const api = setupApiTests();
  it("shares comments on the original and restricts editing and moderation", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob"),
      carol = api.client("carol");
    const group = await alice.groups.create({ name: "Discussion" });
    const link = await alice.links.create({
      title: "Read",
      url: "https://example.com",
      groupId: group.id,
    });
    await assert.rejects(api.client(null).comments.create({ linkId: link.id, body: "Hi" }), {
      code: "UNAUTHORIZED",
    });
    const comment = await bob.comments.create({ linkId: link.id, body: "  Hello  " });
    assert.equal(comment.body, "Hello");
    assert.equal(comment.authorId, "bob");
    const listed = await api.client(null).comments.list({ linkId: link.id });
    assert.equal(listed.items[0]?.id, comment.id);
    assert.equal("email" in listed.items[0]!.author, false);
    await assert.rejects(alice.comments.update({ id: comment.id, body: "Owner edit" }), {
      code: "NOT_FOUND",
    });
    await assert.rejects(carol.comments.delete({ id: comment.id }), { code: "NOT_FOUND" });
    assert.equal((await bob.comments.update({ id: comment.id, body: "Edited" })).body, "Edited");
    await alice.comments.delete({ id: comment.id });
    assert.equal((await alice.comments.list({ linkId: link.id })).items.length, 0);
  });

  it("revocation hides comments and prevents posting/editing, but allows deleting one's own", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    const group = await alice.groups.create({ name: "Discussion" });
    const link = await alice.links.create({
      title: "Read",
      url: "https://example.com",
      groupId: group.id,
    });
    const comment = await bob.comments.create({ linkId: link.id, body: "Mine" });
    await alice.groups.update({ id: group.id, visibility: "private" });
    await assert.rejects(bob.comments.list({ linkId: link.id }), { code: "NOT_FOUND" });
    await assert.rejects(bob.comments.create({ linkId: link.id, body: "Another" }), {
      code: "NOT_FOUND",
    });
    await assert.rejects(bob.comments.update({ id: comment.id, body: "Edited" }), {
      code: "NOT_FOUND",
    });
    await bob.comments.delete({ id: comment.id });
    assert.equal((await alice.comments.list({ linkId: link.id })).items.length, 0);
  });

  it("paginates and validates comments without leaking another link's records", async () => {
    const alice = api.client("alice");
    const link = await alice.links.create({ title: "Private", url: "https://example.com" });
    await alice.comments.create({ linkId: link.id, body: "One" });
    await alice.comments.create({ linkId: link.id, body: "Two" });
    const first = await alice.comments.list({ linkId: link.id, limit: 1 });
    const second = await alice.comments.list({
      linkId: link.id,
      limit: 1,
      cursor: first.nextCursor!,
    });
    assert.notEqual(first.items[0]?.id, second.items[0]?.id);
    assert.equal(second.nextCursor, null);
    await assert.rejects(alice.comments.create({ linkId: link.id, body: " " }), {
      code: "BAD_REQUEST",
    });
    await assert.rejects(alice.comments.create({ linkId: link.id, body: "x".repeat(5001) }), {
      code: "BAD_REQUEST",
    });
    await assert.rejects(
      api.client("bob").comments.list({ linkId: link.id, cursor: first.nextCursor! }),
      { code: "NOT_FOUND" },
    );
    await assert.rejects(alice.comments.list({ linkId: link.id, cursor: "bad" }), {
      code: "BAD_REQUEST",
    });
  });
});
