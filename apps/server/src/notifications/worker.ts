import { providerToken } from "@index/api/features/notifications/provider-tokens";
import { cleanup } from "@index/api/features/notifications/repository";
import { deliverBatch } from "@index/api/features/notifications/delivery";
import { getDb } from "../services";
import { ENV } from "../env.server";
import { createPushAdapter } from "./adapters";
export async function runNotifications() {
  const db = getDb();
  if (ENV.NOTIFICATIONS_ENABLED !== "true") {
    await cleanup(db);
    return;
  }
  const send = await createPushAdapter(ENV, fetch, (key, issue) => providerToken(db, key, issue));
  // A bounded cron invocation drains up to 200 jobs; remaining rows survive to the next tick.
  for (let i = 0; i < 5; i++) {
    if ((await deliverBatch(db, send)).attempted < 40) break;
  }
}
