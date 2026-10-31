import { DurableObject } from "cloudflare:workers";
import * as repo from "@index/api/features/live/repository";
import { getDb } from "../services";
import { runNotifications } from "../notifications/worker";
import { ENV } from "../env.server";
import { call, hub } from "./services";
import { OutboxSchedule } from "./schedule";

export class OutboxClock extends DurableObject {
  private schedule = new OutboxSchedule(this.ctx.storage);
  async fetch(request: Request) {
    const { id } = (await request.json()) as { id?: string };
    if (new URL(request.url).pathname === "/begin" && id) await this.schedule.begin(id);
    else await this.schedule.finish(id);
    return Response.json({ success: true });
  }
  async alarm() {
    await this.schedule.run(async () => {
      const db = getDb();
      const rows = await repo.changes(db);
      for (const row of rows) {
        await call(hub(row.userId), "/notify", { sessionChanged: row.sessionChanged });
        await repo.acknowledge(db, row.userId, row.version);
      }
      await runNotifications();
      if (rows.length === 200) return Date.now();
      return ENV.NOTIFICATIONS_ENABLED === "true" ? repo.nextDelivery(db) : undefined;
    });
  }
}
