import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activities, comments } from "@index/db/schema/app";
import { setupApiTests } from "../../testing/api";

describe("comment receipts", () => {
  const api = setupApiTests();

  it("answers a retry with the comment it posted, once, and scopes IDs to the author", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    const link = await alice.links.create({ url: "https://example.com", title: "Read" });
    const input = { linkId: link.id, body: "Nice", clientId: crypto.randomUUID() };
    const posted = await bob.comments.create(input);
    const retries = await Promise.all([bob.comments.create(input), bob.comments.create(input)]);
    assert.deepEqual(retries, [posted, posted]);
    assert.equal((await api.db.select().from(comments)).length, 1);
    assert.equal((await api.db.select().from(activities)).length, 1);

    const own = await alice.comments.create(input);
    assert.notEqual(own.id, posted.id);
    // Without a client ID every post is a new comment, as before.
    const plain = { linkId: link.id, body: "Again" };
    await bob.comments.create(plain);
    await bob.comments.create(plain);
    assert.equal((await api.db.select().from(comments)).length, 4);
  });

  it("returns a committed comment before checking access again", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    const group = await alice.groups.create({ name: "Reading" });
    const link = await alice.links.create({
      url: "https://example.com",
      title: "Read",
      groupId: group.id,
    });
    const input = { linkId: link.id, body: "Nice", clientId: crypto.randomUUID() };
    const posted = await bob.comments.create(input);
    await alice.groups.update({ id: group.id, visibility: "private" });
    assert.deepEqual(await bob.comments.create(input), posted);
    await assert.rejects(bob.comments.create({ ...input, clientId: crypto.randomUUID() }), {
      code: "NOT_FOUND",
    });
  });

  it("rejects an ID reused for another link or text, including after an edit", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    const link = await alice.links.create({ url: "https://example.com", title: "Read" });
    const other = await alice.links.create({ url: "https://example.org", title: "Other" });
    const input = { linkId: link.id, body: "Nice", clientId: crypto.randomUUID() };
    const posted = await bob.comments.create(input);
    for (const changed of [{ body: "Changed" }, { linkId: other.id }])
      await assert.rejects(bob.comments.create({ ...input, ...changed }), { code: "CONFLICT" });
    // A missing link is checked after the receipt, so it doesn't hide the conflict.
    await assert.rejects(bob.comments.create({ ...input, linkId: crypto.randomUUID() }), {
      code: "CONFLICT",
    });
    await bob.comments.update({ id: posted.id, body: "Edited" });
    await assert.rejects(bob.comments.create(input), { code: "CONFLICT" });
    assert.equal((await api.db.select().from(comments)).length, 1);
  });
});
