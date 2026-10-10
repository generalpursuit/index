import { usernameAliases } from "@index/db/schema/auth";
import type { relations } from "@index/db/relations";
import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { usernameSchema } from "./username";

/** Advisory UX check. PostgreSQL reserves names atomically on every user write. */
export async function isUsernameAvailable<T extends PgQueryResultHKT>(
  db: PgAsyncDatabase<T, typeof relations>,
  value: string,
  actorId?: string,
): Promise<boolean> {
  const parsed = usernameSchema.safeParse(value);
  if (!parsed.success) return false;
  const [reservation] = await db
    .select({ userId: usernameAliases.userId })
    .from(usernameAliases)
    .where(eq(usernameAliases.username, parsed.data))
    .limit(1);
  return !reservation || (!!actorId && reservation.userId === actorId);
}
