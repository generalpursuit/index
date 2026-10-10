import assert from "node:assert/strict";
import { it } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { URL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { relations } from "@index/db/relations";
import { createAuth } from "@index/auth";

it("upgrades legacy unverified password accounts without verifying them or losing their content", async () => {
  const client = new PGlite();
  const base = new URL("../../../db/src/migrations/", import.meta.url);
  try {
    const migrations = (await readdir(base)).sort();
    await client.exec(await readFile(new URL(`${migrations[0]}/migration.sql`, base), "utf8"));
    let code = "";
    const auth = createAuth(
      {
        BETTER_AUTH_URL: "https://api.example.test",
        BETTER_AUTH_SECRET: "legacy-test-secret-at-least-32-characters",
        CORS_ORIGIN: "https://web.example.test",
      },
      drizzle({ client, relations }),
      [],
      {
        sendEmail: async (email) => {
          code = email.code;
        },
      },
    );
    const hash = await (await auth.$context).password.hash("legacy-password-123");
    await client.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [
      "legacy",
      "Legacy",
      "legacy@example.test",
    ]);
    await client.query(
      "INSERT INTO account(id,account_id,provider_id,user_id,password,updated_at) VALUES($1,$2,$3,$4,$5,now())",
      ["credential", "legacy", "credential", "legacy", hash],
    );
    await client.exec(
      "INSERT INTO links(owner_id,url,title) VALUES('legacy','https://example.com','Legacy link')",
    );
    for (const migration of migrations.slice(1))
      await client.exec(await readFile(new URL(`${migration}/migration.sql`, base), "utf8"));
    const old = await client.query<{ email_verified: boolean; username: string }>(
      "SELECT email_verified,username FROM \"user\" WHERE id='legacy'",
    );
    assert.equal(old.rows[0]?.email_verified, false);
    assert.match(old.rows[0]!.username, /^member_/);
    assert.equal(
      (await client.query("SELECT id FROM links WHERE owner_id='legacy'")).rows.length,
      1,
    );

    const post = (path: string, body: unknown, token = "") =>
      auth.handler(
        new Request(`https://api.example.test/api/auth${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        }),
      );
    const login = await post("/sign-in/email", {
      email: "legacy@example.test",
      password: "legacy-password-123",
    });
    assert.equal(login.status, 200);
    const token = login.headers.get("set-auth-token")!;
    assert.equal(
      ((await login.json()) as { user: { emailVerified: boolean } }).user.emailVerified,
      false,
    );
    // A legacy account has never received a signup code. Password sign-in must
    // initiate verification instead of presenting an empty verification screen.
    assert.match(code, /^\d{6}$/);
    assert.equal((await post("/security/verify-email", { code }, token)).status, 200);
  } finally {
    await client.close();
  }
});
