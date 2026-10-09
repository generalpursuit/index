import { comments, groups, links, stars } from "@index/db/schema/app";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupApiTests } from "../../testing/api";

describe("groups and link organization", () => {
  const api = setupApiTests();
  const input = { url: "https://example.com/read", title: "Read" };

  it("only lets the owner edit or delete a link, and cascades a direct deletion", async () => {
    const alice = api.client("alice");
    const group = await alice.groups.create({ name: "Public" });
    const link = await alice.links.create({ ...input, groupId: group.id });
    await api.client("bob").comments.create({ linkId: link.id, body: "Hi" });
    await api.client("bob").stars.add({ linkId: link.id });
    await assert.rejects(api.client("bob").links.delete({ id: link.id }), { code: "NOT_FOUND" });
    await assert.rejects(alice.links.update({ id: link.id, title: undefined }), {
      code: "BAD_REQUEST",
    });
    await alice.links.delete({ id: link.id });
    assert.equal((await api.db.select().from(comments)).length, 0);
    assert.equal((await api.db.select().from(stars)).length, 0);
    await assert.rejects(alice.links.get({ id: link.id }), { code: "NOT_FOUND" });
  });

  it("creates public groups and moves only owned links into owned custom groups", async () => {
    const alice = api.client("alice");
    const group = await alice.groups.create({ name: " Reading " });
    assert.equal(group.name, "Reading");
    assert.equal(group.visibility, "public");
    const link = await alice.links.create(input);
    await assert.rejects(api.client("bob").links.update({ id: link.id, groupId: group.id }), {
      code: "NOT_FOUND",
    });
    await assert.rejects(api.client("bob").links.create({ ...input, groupId: group.id }), {
      code: "NOT_FOUND",
    });
    const bobGroup = await api.client("bob").groups.create({ name: "Bob" });
    await assert.rejects(alice.links.update({ id: link.id, groupId: bobGroup.id }), {
      code: "NOT_FOUND",
    });
    await alice.links.update({
      id: link.id,
      groupId: group.id,
      title: "Changed",
      url: "https://goodreads.com/book/show/1",
    });
    assert.equal((await api.client(null).links.get({ id: link.id })).title, "Changed");
    assert.equal(
      (await alice.links.listMine({ groupId: group.id, category: "book" })).items.length,
      1,
    );
    await alice.links.update({ id: link.id, groupId: null });
    assert.equal((await alice.links.get({ id: link.id })).groupId, null);
    assert.equal((await api.client(null).links.get({ id: link.id })).id, link.id);
  });

  it("keeps Starred unique and protects its name, deletion and original-link membership", async () => {
    const alice = api.client("alice");
    const first = await alice.stars.group();
    assert.equal((await alice.stars.group()).id, first.id);
    await assert.rejects(alice.groups.update({ id: first.id, name: "Other" }), {
      code: "NOT_FOUND",
    });
    await assert.rejects(alice.groups.delete({ id: first.id }), { code: "NOT_FOUND" });
    await assert.rejects(alice.links.create({ ...input, groupId: first.id }), {
      code: "NOT_FOUND",
    });
    assert.equal(
      (await alice.groups.update({ id: first.id, visibility: "private" })).visibility,
      "private",
    );
    assert.equal((await api.db.select().from(groups)).length, 1);
  });

  it("deleting a group keeps its links, now outside any group", async () => {
    const alice = api.client("alice");
    const group = await alice.groups.create({ name: "Delete", visibility: "private" });
    const link = await alice.links.create({ ...input, groupId: group.id });
    await assert.rejects(api.client("bob").groups.delete({ id: group.id }), { code: "NOT_FOUND" });
    await assert.rejects(api.client(null).links.get({ id: link.id }), { code: "NOT_FOUND" });
    await alice.groups.delete({ id: group.id });
    assert.equal((await alice.links.get({ id: link.id })).groupId, null);
    // Without a lock the link follows the profile, so clients must warn before this.
    assert.equal((await api.client(null).links.get({ id: link.id })).id, link.id);
  });

  it("explicit deletion removes links and cascades their comments and stars", async () => {
    const alice = api.client("alice");
    const group = await alice.groups.create({ name: "Delete" });
    const link = await alice.links.create({ ...input, groupId: group.id });
    await api.client("bob").stars.add({ linkId: link.id });
    await api.client("bob").comments.create({ linkId: link.id, body: "Hi" });
    await alice.groups.delete({ id: group.id, deleteLinks: true });
    assert.equal((await api.db.select().from(links)).length, 0);
    assert.equal((await api.db.select().from(comments)).length, 0);
    assert.equal((await api.db.select().from(stars)).length, 0);
  });

  it("rolls back link movement when group deletion fails", async () => {
    const alice = api.client("alice");
    const group = await alice.groups.create({ name: "Fail" });
    const link = await alice.links.create({ ...input, groupId: group.id });
    await api.postgres.exec(
      `CREATE FUNCTION reject_group_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$; CREATE TRIGGER reject_group_delete BEFORE DELETE ON groups FOR EACH ROW EXECUTE FUNCTION reject_group_delete();`,
    );
    try {
      await assert.rejects(alice.groups.delete({ id: group.id }), {
        code: "INTERNAL_SERVER_ERROR",
      });
      assert.equal(
        (await api.db.select().from(links).where(eq(links.id, link.id)))[0]?.groupId,
        group.id,
      );
      assert.equal((await alice.groups.get({ id: group.id })).id, group.id);
    } finally {
      await api.postgres.exec(
        "DROP TRIGGER reject_group_delete ON groups; DROP FUNCTION reject_group_delete();",
      );
    }
  });

  it("paginates groups, validates updates, and prevents unauthorized mutation", async () => {
    const alice = api.client("alice");
    const group = await alice.groups.create({ name: "One" });
    await alice.groups.create({ name: "Two" });
    const first = await alice.groups.list({ limit: 1 });
    const second = await alice.groups.list({ limit: 1, cursor: first.nextCursor! });
    assert.notEqual(first.items[0]?.id, second.items[0]?.id);
    await assert.rejects(alice.groups.update({ id: group.id }), { code: "BAD_REQUEST" });
    await assert.rejects(api.client("bob").groups.update({ id: group.id, name: "Stolen" }), {
      code: "NOT_FOUND",
    });
    await assert.rejects(api.client(null).groups.create({ name: "No" }), { code: "UNAUTHORIZED" });
  });

  it("lists each group with how many of its links the viewer may see", async () => {
    const alice = api.client("alice");
    const reading = await alice.groups.create({ name: "Reading" });
    const one = await alice.links.create({ ...input, groupId: reading.id });
    await alice.links.create({ ...input, url: "https://example.com/two", groupId: reading.id });
    await alice.links.create({ ...input, url: "https://example.com/loose" });
    await alice.favorites.add({ linkId: one.id });
    const counts = async (viewer: string) =>
      Object.fromEntries(
        (await api.client(viewer).groups.list({ ownerId: "alice" })).items.map((g) => [
          g.name,
          g.linkCount,
        ]),
      );
    assert.equal((await counts("alice")).Reading, 2);
    assert.equal((await counts("alice")).Favorites, 1);
    // Others see the same counts for what they may see.
    assert.equal((await counts("bob")).Reading, 2);
  });
});
