import { PGlite } from "@electric-sql/pglite";
import { memoryFileStore } from "../features/messages/files";
import { memoryMediaStore } from "../features/profiles/media";
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
    await client.exec(
      'TRUNCATE TABLE "user", conversations, short_routes, auth_throttle, auth_challenge, live_changes CASCADE',
    );
    await db.insert(user).values([
      {
        id: "alice",
        name: "Alice",
        username: "alice",
        email: "alice@example.com",
        emailVerified: true,
      },
      { id: "bob", name: "Bob", username: "bob", email: "bob@example.com", emailVerified: true },
    ]);
  }

  // Tests never reach the network; links fall back to what their URL says and imports fail.
  function context(actorId: string | null): Context {
    return {
      db,
      session: actorId ? sessionFor(actorId) : null,
      fetchPage: offline,
      fetchImport: offline,
      media,
      files,
    };
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
      emailVerified: true,
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

const offline: Context["fetchPage"] = () => Promise.reject(new TypeError("Offline in tests."));
/** Photos uploaded in tests stay in memory. */
export const media = memoryMediaStore("https://api.example.test");

/** Files uploaded in tests stay in memory. */
export const files = memoryFileStore();
