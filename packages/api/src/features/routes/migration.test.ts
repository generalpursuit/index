import assert from "node:assert/strict";
import { it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { groupSchema } from "../groups/schemas";
import { groupSlug, normalizeGroupName } from "../../routes";
const initial = new URL(
  "../../../../db/src/migrations/20261009101141_initial/migration.sql",
  import.meta.url,
);
const migration = new URL(
  "../../../../db/src/migrations/20261010095101_readable_routes/migration.sql",
  import.meta.url,
);
it("repairs real legacy duplicate/reserved/expanded names deterministically without losing links", async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(initial, "utf8"));
    await db.exec(
      `INSERT INTO "user"(id,name,email) VALUES('legacy','Legacy','legacy@test.example')`,
    );
    const names = [
      "Read Later",
      "read later",
      "Read-Later",
      "Starred",
      "Ｆａｖｏｒｉｔｅｓ",
      "ﬃ".repeat(100),
      "😀".repeat(50),
      "😀".repeat(50),
      "İdea",
      "FAVORİTES",
      "\uFEFFRead\uFEFF",
    ];
    const ids = names.map((_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
    for (const [i, name] of names.entries()) {
      await db.query(
        `INSERT INTO groups(id,owner_id,name,created_at) VALUES($1,'legacy',$2,'2020-01-01')`,
        [ids[i], name],
      );
      await db.query(
        `INSERT INTO links(owner_id,group_id,url,title) VALUES('legacy',$1,'https://example.com',$2)`,
        [ids[i], name],
      );
    }
    await db.exec(await readFile(migration, "utf8"));
    const result = await db.query<{ id: string; name: string; slug: string }>(
      `SELECT id,name,slug FROM groups ORDER BY id`,
    );
    assert.equal(result.rows.length, names.length);
    const expected = ["read-later", "read-later-2", "read-later-3", "starred-2", "favorites-2"];
    assert.deepEqual(
      result.rows.slice(0, 5).map((r) => r.slug),
      expected,
    );
    assert.equal(result.rows[5]!.name, "ffi".repeat(100));
    assert.equal(new Set(result.rows.map((r) => r.slug)).size, names.length);
    for (const [i, group] of result.rows.entries()) {
      assert.equal(group.id, ids[i]);
      assert.equal(group.slug, groupSlug(group.name));
      assert.equal(group.name, normalizeGroupName(group.name));
      groupSchema.parse({
        ...group,
        ownerId: "legacy",
        kind: "custom",
        visibility: "public",
        createdAt: "2020-01-01T00:00:00Z",
        updatedAt: "2020-01-01T00:00:00Z",
      });
      const link = await db.query(`SELECT id FROM links WHERE group_id=$1`, [group.id]);
      assert.equal(link.rows.length, 1);
    }
    const user = await db.query<{ username: string }>(
      `SELECT username FROM "user" WHERE id='legacy'`,
    );
    assert.match(user.rows[0]!.username, /^member_[a-f0-9]{16}$/);
    const aliases = await db.query(`SELECT * FROM group_aliases`);
    assert.equal(aliases.rows.length, names.length);
  } finally {
    await db.close();
  }
});
