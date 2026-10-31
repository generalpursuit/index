import { and, eq, sql } from "drizzle-orm";
import { notificationDevices } from "@index/db/schema/notifications";
import type { QueryDatabase } from "../../data-access/database";
import type { Alert } from "./schemas";
import * as repo from "./repository";
// Transport receives only a destination. Registration ownership and deletion stay here.
export type DeliveryDestination =
  | { kind: "web"; endpoint: string | null; p256dh: string | null; auth: string | null }
  | { kind: "apns"; token: string | null; environment: "sandbox" | "production" | null }
  | { kind: "desktop" };
export type DeliveryFailure =
  | "provider_disabled"
  | "provider_configuration"
  | "provider_authentication"
  | "invalid_destination"
  | "rate_limited"
  | "provider_unavailable"
  | "provider_rejected"
  | "network_error";
export type DeliveryResult = {
  status: "sent" | "dead" | "retry" | "failed";
  retryAfter?: number;
  reason?: DeliveryFailure;
};
export type DeliveryAdapter = (
  destination: DeliveryDestination,
  alert: Alert,
) => Promise<DeliveryResult>;
/** Bounded, durable attempts. Provider collapse/tag identifiers use the job UUID on every retry. */
export async function deliverBatch(
  db: QueryDatabase,
  send: DeliveryAdapter,
  limit = 40,
  active?: (userId: string, sessionId: string, conversationId: string) => Promise<boolean>,
) {
  const jobs = await repo.claim(db, null, limit);
  const deliver = async (job: repo.Claim) => {
    if (!(await repo.renewLease(db, job))) return;
    const prepared = await repo.prepare(db, job.id);
    if (!prepared) {
      await repo.finish(db, job, "discarded", "ineligible");
      return;
    }
    if (
      prepared.alert.conversationId &&
      (await active?.(
        prepared.device.userId,
        prepared.device.sessionId,
        prepared.alert.conversationId,
      ))
    ) {
      await repo.finish(db, job, "discarded", "active");
      return;
    }
    let result: DeliveryResult;
    try {
      const device = prepared.device;
      const destination: DeliveryDestination =
        device.kind === "web"
          ? { kind: "web", endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth }
          : device.kind === "apns"
            ? { kind: "apns", token: device.endpoint, environment: device.environment }
            : { kind: "desktop" };
      result = await send(destination, prepared.alert);
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
      await repo.finish(db, job, "failed", result.reason ?? "exhausted");
    else
      await repo.finish(
        db,
        job,
        "pending",
        result.reason ?? "retry",
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
