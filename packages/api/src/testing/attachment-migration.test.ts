import { URL } from "node:url";
import { test } from "node:test";
import { deepStrictEqual } from "node:assert";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
test("attachment migration distinguishes text, surviving references and deleted attachment-only messages", async () => {
  const db = new PGlite(),
    migrations = new URL("../../../db/src/migrations/", import.meta.url);
  try {
    for (const name of [
      "20261008102606_black_namorita",
      "20261008112556_social_library",
      "20261008175003_prototype_api",
    ])
      await db.exec(await readFile(new URL(name + "/migration.sql", migrations), "utf8"));
    await db.exec(`
   insert into "user"(id,name,email) values ('alice','Alice','alice@example.com');
   insert into conversations(id,member_key) values ('00000000-0000-4000-8000-000000000010','["alice"]');
   insert into conversation_members(conversation_id,user_id) values ('00000000-0000-4000-8000-000000000010','alice');
   insert into links(id,owner_id,title,url) values ('00000000-0000-4000-8000-000000000020','alice','An original','https://example.com');
   insert into messages(conversation_id,sender_id,client_id,body,link_id) values
   ('00000000-0000-4000-8000-000000000010','alice','00000000-0000-4000-8000-000000000001','Text only',null),
   ('00000000-0000-4000-8000-000000000010','alice','00000000-0000-4000-8000-000000000002','With original','00000000-0000-4000-8000-000000000020'),
   ('00000000-0000-4000-8000-000000000010','alice','00000000-0000-4000-8000-000000000003','',null);
  `);
    await db.exec(
      await readFile(
        new URL("20261008184316_message_attachments/migration.sql", migrations),
        "utf8",
      ),
    );
    deepStrictEqual(
      (await db.query("select has_attachment from messages order by client_id")).rows,
      [{ has_attachment: false }, { has_attachment: true }, { has_attachment: true }],
    );
    await db.exec("delete from links");
    deepStrictEqual(
      (await db.query("select link_id,has_attachment from messages order by client_id")).rows,
      [
        { link_id: null, has_attachment: false },
        { link_id: null, has_attachment: true },
        { link_id: null, has_attachment: true },
      ],
    );
  } finally {
    await db.close();
  }
});
