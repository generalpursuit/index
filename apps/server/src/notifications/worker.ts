import { providerToken } from "@index/api/features/notifications/provider-tokens";
import { deliverBatch } from "@index/api/features/notifications/delivery";
import { getDb } from "../services";
import { ENV } from "../env.server";
import { createPushAdapter } from "./adapters";
import { livePresence } from "../live/services";
export async function runNotifications() {
  const db = getDb();
  if (ENV.NOTIFICATIONS_ENABLED !== "true") {
    return;
  }
  const send = await createPushAdapter(ENV, fetch, (key, issue) => providerToken(db, key, issue));
  // A bounded alarm drains up to 200 jobs; remaining rows keep the clock armed.
  for (let i = 0; i < 5; i++) {
    if ((await deliverBatch(db, send, 40, livePresence.isActive)).attempted < 40) break;
  }
}
