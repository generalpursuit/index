import { and, eq, sql } from "drizzle-orm";
import { notificationProviderTokens as tokens } from "@index/db/schema/notifications";
import type { QueryDatabase } from "../../data-access/database";
/** Concurrent/cold Worker isolates use the same short-lived APNs provider JWT. */
export async function providerToken(db: QueryDatabase, key: string, create: () => Promise<string>) {
  const fresh = () =>
    db
      .select({ token: tokens.token })
      .from(tokens)
      .where(and(eq(tokens.key, key), sql`${tokens.expiresAt} > now() + interval '2 minutes'`));
  const [cached] = await fresh();
  if (cached) return cached.token;
  const token = await create();
  const values = { key, token, expiresAt: new Date(Date.now() + 45 * 60_000) };
  // Only the winner's JWT may be sent. Do not rotate a token newly created by another isolate.
  const [written] = await db
    .insert(tokens)
    .values(values)
    .onConflictDoUpdate({
      target: tokens.key,
      set: values,
      setWhere: sql`${tokens.expiresAt} <= now() + interval '2 minutes'`,
    })
    .returning({ token: tokens.token });
  const result = written ?? (await fresh())[0];
  if (!result) throw new Error("Provider token unavailable");
  return result.token;
}
