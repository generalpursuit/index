import { test } from "node:test";
import { deepStrictEqual } from "node:assert";
import { URL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

test("prototype migration preserves save dates, self-star privacy and pending requests", async () => {
  const db = new PGlite();
  const migrations = new URL("../../../db/src/migrations/", import.meta.url);
  try {
    for (const name of ["20261008102606_black_namorita", "20261008112556_social_library"]) {
      await db.exec(await readFile(new URL(`${name}/migration.sql`, migrations), "utf8"));
    }
    await db.exec(`
      insert into "user"(id,name,email) values
        ('alice','Alice','alice@example.com'), ('bob','Bob','bob@example.com');
      insert into groups(id,owner_id,name,kind,visibility) values
        ('00000000-0000-4000-8000-000000000001','alice','Starred','starred','private');
      insert into links(id,owner_id,title,url,created_at) values
        ('00000000-0000-4000-8000-000000000002','alice','Own link','https://example.com/own','2025-12-31 23:30:00-05'),
        ('00000000-0000-4000-8000-000000000003','bob','Other link','https://example.com/other','2026-01-02 12:00:00Z');
      insert into stars(group_id,link_id,created_at) values
        ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','2026-02-01 12:00:00Z'),
        ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','2026-02-02 12:00:00Z');
      insert into follows(follower_id,followed_id,status,created_at,accepted_at) values
        ('bob','alice','pending','2026-02-03 12:00:00Z',null),
        ('alice','bob','accepted','2026-02-04 12:00:00Z','2026-02-04 12:00:00Z');
    `);
    await db.exec(
      await readFile(new URL("20261008175003_prototype_api/migration.sql", migrations), "utf8"),
    );
    deepStrictEqual((await db.query("select saved_on::text from links order by id")).rows, [
      { saved_on: "2026-01-01" },
      { saved_on: "2026-01-02" },
    ]);
    deepStrictEqual((await db.query("select owner_id, link_id, created_at from favorites")).rows, [
      {
        owner_id: "alice",
        link_id: "00000000-0000-4000-8000-000000000002",
        created_at: new Date("2026-02-01T12:00:00Z"),
      },
    ]);
    deepStrictEqual(
      (await db.query("select owner_id, name, visibility from groups where kind='favorites'")).rows,
      [{ owner_id: "alice", name: "Favorites", visibility: "private" }],
    );
    deepStrictEqual((await db.query("select link_id from stars")).rows, [
      { link_id: "00000000-0000-4000-8000-000000000003" },
    ]);
    deepStrictEqual(
      (
        await db.query(
          "select recipient_id, actor_id, type, request_status, created_at, read_at from activities",
        )
      ).rows,
      [
        {
          recipient_id: "alice",
          actor_id: "bob",
          type: "request",
          request_status: "pending",
          created_at: new Date("2026-02-03T12:00:00Z"),
          read_at: null,
        },
      ],
    );
  } finally {
    await db.close();
  }
});
