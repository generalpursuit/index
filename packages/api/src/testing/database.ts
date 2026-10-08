import { PGlite } from "@electric-sql/pglite";
import type { Session } from "@index/auth";
import { user } from "@index/db/schema/auth";
import { relations } from "@index/db/relations";
import { drizzle } from "drizzle-orm/pglite";
import { readdir, readFile } from "node:fs/promises";
import { URL } from "node:url";

import type { Context } from "../context";

export async function createTestDatabase() {
  const client = new PGlite();
  const db = drizzle({ client, relations });
  const migrations = new URL("../../../db/src/migrations/", import.meta.url);
  const directories = (await readdir(migrations, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const directory of directories) {
    await client.exec(await readFile(new URL(`${directory}/migration.sql`, migrations), "utf8"));
  }

  async function reset() {
    await client.exec('TRUNCATE TABLE "user" CASCADE');
    await db.insert(user).values([
      { id: "alice", name: "Alice", email: "alice@example.com" },
      { id: "bob", name: "Bob", email: "bob@example.com" },
    ]);
  }

  function context(actorId: string | null): Context {
    return { db, session: actorId ? sessionFor(actorId) : null };
  }

  return { db, client, reset, context, close: () => client.close() };
}

function sessionFor(userId: string): Session {
  const now = new Date();
  return {
    user: {
      id: userId,
      name: userId,
      email: `${userId}@example.com`,
      emailVerified: false,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: `session-${userId}`,
      token: `test-token-${userId}`,
      userId,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
  };
}
