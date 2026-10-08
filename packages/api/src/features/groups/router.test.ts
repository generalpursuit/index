import { groups, links } from "@index/db/schema/app";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupApiTests } from "../../testing/api";

describe("groups and link organization", () => {
  const api = setupApiTests();
  const input = { url: "https://example.com/read", title: "Read" };

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
      category: "book",
    });
    assert.equal((await api.client(null).links.get({ id: link.id })).title, "Changed");
    assert.equal(
      (await alice.links.listMine({ groupId: group.id, category: "book" })).items.length,
      1,
    );
    assert.equal((await alice.links.listMine({ inbox: true })).items.length, 0);
    await alice.links.update({ id: link.id, groupId: null });
    await assert.rejects(api.client(null).links.get({ id: link.id }), { code: "NOT_FOUND" });
    assert.equal((await alice.links.listMine({ inbox: true })).items.length, 1);
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

  it("deleting a group defaults to preserving links in the private inbox", async () => {
    const alice = api.client("alice");
    const group = await alice.groups.create({ name: "Delete" });
    const link = await alice.links.create({ ...input, groupId: group.id });
    await assert.rejects(api.client("bob").groups.delete({ id: group.id }), { code: "NOT_FOUND" });
    await alice.groups.delete({ id: group.id });
    assert.equal((await alice.links.get({ id: link.id })).groupId, null);
    await assert.rejects(api.client(null).links.get({ id: link.id }), { code: "NOT_FOUND" });
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
});
