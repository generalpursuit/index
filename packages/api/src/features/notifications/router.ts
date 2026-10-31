import { implement, ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { notificationDeliveries } from "@index/db/schema/notifications";
import type { Context } from "../../context";
import { requireAuth } from "../../procedures";
import { notificationsContract } from "./contract";
import * as repo from "./repository";
const api = implement(notificationsContract)
  .$context<Context>()
  .use(requireAuth)
  .use(async ({ context, next }, input) => {
    if (
      input &&
      typeof input === "object" &&
      "sessionId" in input &&
      input.sessionId !== context.session.session.id
    )
      throw new ORPCError("UNAUTHORIZED");
    return next();
  });
const capabilities = (c: Context) =>
  c.notifications ?? {
    web: false,
    apns: false,
    apnsEnvironment: null,
    desktop: true,
    vapidPublicKey: null,
  };
async function requireDevice(context: Context & { actorId: string }, installation: string) {
  const device = await repo.ownedDevice(
    context.db,
    context.actorId,
    context.session!.session.id,
    installation,
  );
  if (!device) throw new ORPCError("NOT_FOUND");
  return device;
}
export const notificationsRouter = api.router({
  preferences: api.preferences.handler(({ context }) =>
    repo.getPreferences(context.db, context.actorId),
  ),
  updatePreferences: api.updatePreferences.handler(({ context, input }) =>
    repo.updatePreferences(context.db, context.actorId, input),
  ),
  capabilities: api.capabilities.handler(({ context }) => ({
    ...capabilities(context),
    sessionId: context.session.session.id,
  })),
  register: api.register.handler(({ context, input }) => {
    const enabled = capabilities(context);
    if (input.kind === "apns" && input.environment !== enabled.apnsEnvironment)
      throw new ORPCError("BAD_REQUEST", {
        message: "This app uses a different APNs environment.",
      });
    if (!enabled[input.kind])
      throw new ORPCError("BAD_REQUEST", {
        message: "Notification delivery is not configured for this device.",
      });
    return repo.register(context.db, context.actorId, context.session.session.id, input);
  }),
  status: api.status.handler(async ({ context, input }) => ({
    registered: !!(await repo.ownedDevice(
      context.db,
      context.actorId,
      context.session.session.id,
      input.installation,
    )),
  })),
  unregister: api.unregister.handler(({ context, input }) =>
    repo.unregister(context.db, context.actorId, context.session.session.id, input.installation),
  ),
  active: api.active.handler(async ({ context, input }) => {
    const device = await requireDevice(context, input.installation);
    if (context.live) {
      await context.live.active(context.actorId, device.sessionId, input.conversationId);
      return { success: true as const };
    }
    return repo.active(context.db, device.id, context.actorId, input.conversationId);
  }),
  poll: api.poll.handler(async ({ context, input }) => {
    const device = await requireDevice(context, input.installation);
    if (device.kind !== "desktop") throw new ORPCError("BAD_REQUEST");
    const jobs = await repo.claim(context.db, device.id, 20);
    const items = [];
    for (const job of jobs) {
      const result = await repo.prepare(context.db, job.id, device.id);
      if (
        result &&
        !(
          result.alert.conversationId &&
          (await context.live?.isActive(
            context.actorId,
            device.sessionId,
            result.alert.conversationId,
          ))
        )
      )
        items.push({ alert: result.alert, lease: job.lease });
      else await repo.finish(context.db, job, "discarded", "ineligible");
    }
    return {
      items,
      hasMore: jobs.length === 20,
      retryAfterSeconds: await repo.nextDeviceAttempt(
        context.db,
        device.id,
        jobs.map((job) => job.id),
      ),
    };
  }),
  ack: api.ack.handler(async ({ context, input }) => {
    const device = await requireDevice(context, input.installation);
    await context.db
      .update(notificationDeliveries)
      .set({ state: "delivered", lease: null, outcome: { code: "acknowledged" } })
      .where(
        and(
          eq(notificationDeliveries.id, input.id),
          eq(notificationDeliveries.deviceId, device.id),
          eq(notificationDeliveries.lease, input.lease),
          eq(notificationDeliveries.state, "pending"),
        ),
      );
    return { success: true as const };
  }),
  resolve: api.resolve.handler(async ({ context, input }) => {
    const device = await requireDevice(context, input.installation);
    return (
      (await repo.prepare(context.db, input.id, device.id, true, input.opening))?.alert ?? null
    );
  }),
});
