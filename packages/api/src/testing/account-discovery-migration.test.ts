import assert from "node:assert/strict";
import { it } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { URL } from "node:url";
import { PGlite } from "@electric-sql/pglite";

it("hides only the Apple review account during upgrade and keeps other accounts discoverable", async () => {
  const client = new PGlite();
  const base = new URL("../../../db/src/migrations/", import.meta.url);
  try {
    const migrations = (await readdir(base)).sort();
    const target = migrations.findIndex((name) => name.endsWith("_account_discovery"));
    assert.ok(target > 0);
    for (const migration of migrations.slice(0, target))
      await client.exec(await readFile(new URL(`${migration}/migration.sql`, base), "utf8"));
    const emails = [
      "delivered+indexprobe1791837728@resend.dev",
      "delivered+webprobe1791838084@resend.dev",
      "review@index.invalid",
      "unverified@example.com",
      "review@example.com",
      "delivered+indexprobe1791837728@example.com",
    ];
    for (const [index, email] of emails.entries())
      await client.query(
        'INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, $2, $3, $4)',
        [`user-${index}`, `User ${index}`, email, index === 2],
      );
    await client.exec(await readFile(new URL(`${migrations[target]}/migration.sql`, base), "utf8"));
    await client.exec(
      "INSERT INTO \"user\" (id, name, email) VALUES ('new', 'New', 'new@example.com')",
    );
    const { rows } = await client.query<{ email: string }>(
      'SELECT email FROM "user" WHERE NOT is_discoverable ORDER BY email',
    );
    assert.deepEqual(
      rows.map((row) => row.email),
      ["review@index.invalid"],
    );
    const { rows: visible } = await client.query('SELECT id FROM "user" WHERE is_discoverable');
    assert.equal(visible.length, 6);
  } finally {
    await client.close();
  }
});
