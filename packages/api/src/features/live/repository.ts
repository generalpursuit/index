import { and, eq, sql } from "drizzle-orm";
import { liveChanges } from "@index/db/schema/live";
import { notificationDeliveries, notificationDevices } from "@index/db/schema/notifications";
import type { QueryDatabase } from "../../data-access/database";

export function changes(db: QueryDatabase, limit = 200) {
  return db
    .select()
    .from(liveChanges)
    .orderBy(liveChanges.updatedAt, liveChanges.userId)
    .limit(limit);
}
export function acknowledge(db: QueryDatabase, userId: string, version: string) {
  return db
    .delete(liveChanges)
    .where(and(eq(liveChanges.userId, userId), eq(liveChanges.version, version)));
}
export async function nextDelivery(db: QueryDatabase) {
  const [row] = await db
    .select({ at: sql<Date | string | null>`min(${notificationDeliveries.nextAttemptAt})` })
    .from(notificationDeliveries)
    .innerJoin(notificationDevices, eq(notificationDevices.id, notificationDeliveries.deviceId))
    .where(
      and(
        eq(notificationDeliveries.state, "pending"),
        sql`${notificationDeliveries.attempts} < 8`,
        sql`${notificationDevices.kind} <> 'desktop'`,
      ),
    );
  return row?.at ? new Date(row.at).getTime() : undefined;
}
