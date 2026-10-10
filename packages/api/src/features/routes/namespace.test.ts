import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import { groups } from "@index/db/schema/app";
import { user } from "@index/db/schema/auth";
import { isUsernameAvailable } from "@index/auth/namespace";
import { groupSlug, normalizeGroupName, profilePath, groupPath, linkPath } from "../../routes";
import { setupApiTests } from "../../testing/api";

describe("durable route namespaces", () => {
  const api = setupApiTests();
  it("uses the same normalized name and slug in JavaScript and PostgreSQL", async () => {
    for (const value of [
      "  Read\t\nLater  ",
      "Ｒｅａｄ",
      "Café",
      "CAFÉ",
      "東京",
      "a---b",
      "\u00a0Read\u00a0",
      "💡 Ideas",
    ]) {
      const rows = await api.db.execute(
        sql`select public.index_group_name(${value}) as name, public.index_group_slug(${value}) as slug`,
      );
      assert.equal(rows.rows[0]!.name, normalizeGroupName(value));
      assert.equal(rows.rows[0]!.slug, groupSlug(value));
    }
    assert.equal(profilePath("alice"), "/u/alice");
    assert.equal(groupPath("alice", "read-later"), "/u/alice/read-later");
    assert.equal(linkPath("a_B-1"), "/l/a_B-1");
  });
  it("rejects case, normalization, punctuation and reserved-name collisions", async () => {
    const alice = api.client("alice");
    const first = await alice.groups.create({ name: "Read Later" });
    for (const name of ["read later", "Ｒｅａｄ Later", "read-later"])
      await assert.rejects(alice.groups.create({ name }), { code: "CONFLICT" });
    for (const name of ["All", "Ｓｔａｒｒｅｄ", "Favorites!", "Settings"])
      await assert.rejects(alice.groups.create({ name }), { code: "BAD_REQUEST" });
    assert.equal(first.slug, "read-later");
    assert.equal((await api.client("bob").groups.create({ name: "Read Later" })).slug, first.slug);
  });
  it("keeps every rename reserved, allows return to own aliases and keeps deletion tombstones", async () => {
    const alice = api.client("alice");
    const group = await alice.groups.create({ name: "First" });
    await alice.groups.update({ id: group.id, name: "Second" });
    await alice.groups.update({ id: group.id, name: "Third" });
    await assert.rejects(alice.groups.create({ name: "First" }), { code: "CONFLICT" });
    await alice.groups.update({ id: group.id, name: "First" });
    await alice.groups.delete({ id: group.id });
    await assert.rejects(alice.groups.create({ name: "Second" }), { code: "CONFLICT" });
    await alice.profiles.update({ username: "alice_new" });
    assert.equal(await isUsernameAvailable(api.db, " ALICE "), false);
    assert.equal(await isUsernameAvailable(api.db, "ALICE", "alice"), true);
    await assert.rejects(api.client("bob").profiles.update({ username: "alice" }), {
      code: "CONFLICT",
    });
    await api.db.delete(user).where(eq(user.id, "alice"));
    assert.equal(await isUsernameAvailable(api.db, "alice_new"), false);
  });
  it("atomic constraints admit only one winner and roll back a losing rename", async () => {
    const alice = api.client("alice");
    const results = await Promise.allSettled([
      alice.groups.create({ name: "Race" }),
      alice.groups.create({ name: "RACE" }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    const other = await alice.groups.create({ name: "Other" });
    await assert.rejects(alice.groups.update({ id: other.id, name: "race" }), { code: "CONFLICT" });
    assert.equal((await alice.groups.get({ id: other.id })).slug, "other");
    const rows = await api.db.select().from(groups).where(eq(groups.ownerId, "alice"));
    assert.equal(rows.length, 2);
    const usernames = await Promise.allSettled([
      alice.profiles.update({ username: "shared" }),
      api.client("bob").profiles.update({ username: "shared" }),
    ]);
    assert.equal(usernames.filter((r) => r.status === "fulfilled").length, 1);
  });
});
