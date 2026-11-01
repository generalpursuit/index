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

it("binds existing token families to their approval and drops those issued under a deleted one", async () => {
  const { client, migrate } = await databaseBefore("_oauth_code_approval");
  try {
    await client.exec(`
      INSERT INTO "user" (id, name, email) VALUES ('person', 'Person', 'person@example.com');
      INSERT INTO oauth_client (id, client_id, redirect_uris) VALUES ('a', 'agent', '{}');
      INSERT INTO oauth_consent (id, client_id, user_id, scopes, created_at) VALUES
        ('approval', 'agent', 'person', '{read}', '2026-11-01 10:00');
      INSERT INTO oauth_refresh_token
        (id, token, client_id, user_id, authorization_code_id, scopes, created_at) VALUES
        ('current', 'r1', 'agent', 'person', 'code-current', '{read}', '2026-11-01 10:05'),
        ('earlier', 'r0', 'agent', 'person', 'code-earlier', '{read}', '2026-11-01 09:00'),
        ('unbound', 'r2', 'agent', 'person', NULL, '{read}', '2026-11-01 10:05');
      INSERT INTO oauth_access_token
        (id, token, client_id, user_id, authorization_code_id, refresh_id, scopes, created_at)
      VALUES
        ('current', 'a1', 'agent', 'person', 'code-current', 'current', '{read}', '2026-11-01 10:05'),
        ('earlier', 'a0', 'agent', 'person', 'code-earlier', 'earlier', '{read}', '2026-11-01 09:00');
    `);
    await migrate();
    const ids = async (table: string) =>
      (await client.query<{ id: string }>(`SELECT id FROM ${table} ORDER BY id`)).rows.map(
        (row) => row.id,
      );
    assert.deepEqual(await ids("oauth_refresh_token"), ["current"]);
    assert.deepEqual(await ids("oauth_access_token"), ["current"]);
    const { rows } = await client.query<{ code_id: string; consent_id: string }>(
      "SELECT code_id, consent_id FROM oauth_code_approval",
    );
    assert.deepEqual(rows, [{ code_id: "code-current", consent_id: "approval" }]);

    // Cleanup removes a binding a day after its code once no token of it is left.
    await client.exec(`
      INSERT INTO oauth_code_approval (code_id, consent_id, created_at)
      VALUES ('code-unused', 'approval', now() - interval '2 days');
      UPDATE oauth_code_approval SET created_at = now() - interval '2 days';
    `);
    await client.query("SELECT index_auth_cleanup()");
    const kept = await client.query<{ code_id: string }>("SELECT code_id FROM oauth_code_approval");
    assert.deepEqual(kept.rows, [{ code_id: "code-current" }]);

    await client.exec("DELETE FROM oauth_consent");
    assert.deepEqual(await ids("oauth_refresh_token"), []);
  } finally {
    await client.close();
  }
});
