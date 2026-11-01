import assert from "node:assert/strict";
import { it } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { URL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const base = new URL("../../../db/src/migrations/", import.meta.url);

/** A database migrated up to, not including, the migration whose name ends with `name`. */
async function databaseBefore(name: string) {
  const client = new PGlite({ extensions: { pg_trgm } });
  const migrations = (await readdir(base)).sort();
  const target = migrations.findIndex((migration) => migration.endsWith(name));
  assert.ok(target > 0);
  for (const migration of migrations.slice(0, target))
    await client.exec(await readFile(new URL(`${migration}/migration.sql`, base), "utf8"));
  return {
    client,
    migrate: async () =>
      client.exec(await readFile(new URL(`${migrations[target]}/migration.sql`, base), "utf8")),
  };
}

it("keeps each account's latest approval of an app when approvals become unique", async () => {
  const { client, migrate } = await databaseBefore("_oauth_consent_unique");
  try {
    await client.exec(`
      INSERT INTO "user" (id, name, email) VALUES ('person', 'Person', 'person@example.com');
      INSERT INTO oauth_client (id, client_id, redirect_uris) VALUES
        ('a', 'agent', '{}'), ('b', 'other', '{}');
      INSERT INTO oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) VALUES
        ('write', 'agent', 'person', '{read,write}', '2026-11-01 10:00', '2026-11-01 10:00'),
        ('narrowed', 'agent', 'person', '{read}', '2026-11-01 10:00', '2026-11-01 11:00'),
        ('other', 'other', 'person', '{read,write}', '2026-11-01 09:00', '2026-11-01 09:00');
    `);
    await migrate();
    const { rows } = await client.query<{ id: string }>("SELECT id FROM oauth_consent ORDER BY id");
    assert.deepEqual(
      rows.map((row) => row.id),
      ["narrowed", "other"],
    );
  } finally {
    await client.close();
  }
});
