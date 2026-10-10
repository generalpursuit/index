import { and, eq, sql } from "drizzle-orm";
import { notificationDevices } from "@index/db/schema/notifications";
import type { QueryDatabase } from "../../data-access/database";
import type { Alert } from "./schemas";
import * as repo from "./repository";
export type DeliveryResult = { status: "sent" | "dead" | "retry" | "failed"; retryAfter?: number };
export type DeliveryAdapter = (
  device: typeof notificationDevices.$inferSelect,
  alert: Alert,
) => Promise<DeliveryResult>;
/** Bounded, durable attempts. Provider collapse/tag identifiers use the job UUID on every retry. */
export async function deliverBatch(db: QueryDatabase, send: DeliveryAdapter, limit = 40) {
  await repo.cleanup(db);
  const jobs = await repo.claim(db, null, limit);
  const deliver = async (job: repo.Claim) => {
    if (!(await repo.renewLease(db, job))) return;
    const prepared = await repo.prepare(db, job.id);
    if (!prepared) {
      await repo.finish(db, job, "discarded", "ineligible");
      return;
    }
    let result: DeliveryResult;
    try {
      result = await send(prepared.device, prepared.alert);
    } catch {
      result = { status: "retry" };
    } // Do not log provider endpoints, credentials or previews.
    if (result.status === "dead") {
      // Avoid deleting a newly rebound/rotated subscription after an old request returns.
      await db
        .delete(notificationDevices)
        .where(
          and(
            eq(notificationDevices.id, prepared.device.id),
            eq(notificationDevices.sessionId, prepared.device.sessionId),
            sql`${notificationDevices.endpointHash} is not distinct from ${prepared.device.endpointHash}`,
          ),
        );
    } else if (result.status === "sent") await repo.finish(db, job, "delivered", "sent");
    else if (result.status === "failed" || job.attempts >= 8)
      await repo.finish(db, job, "failed", "exhausted");
    else
      await repo.finish(
        db,
        job,
        "pending",
        "retry",
        Math.min(3600, Math.max(result.retryAfter ?? 0, 15 * 2 ** (job.attempts - 1))),
      );
  };
  // Bound provider connections and renew each lease immediately before use.
  for (let i = 0; i < jobs.length; i += 4) {
    const results = await Promise.allSettled(jobs.slice(i, i + 4).map(deliver));
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Notification batch interrupted");
  }
  return { attempted: jobs.length };
}
