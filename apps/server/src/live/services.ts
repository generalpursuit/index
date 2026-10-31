import type { Session } from "@index/auth";
import type { Context } from "@index/api/context";
import { ENV } from "../env.server";
import { socketAddress } from "./address";

export const liveBindings = () => ENV;
export function hub(userId: string) {
  return liveBindings().ACCOUNT_HUB.getByName(userId);
}
export async function call(stub: DurableObjectStub, path: string, body: unknown) {
  const response = await stub.fetch(`https://internal${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Live service unavailable");
  return response;
}
export function liveServices(request: Request): NonNullable<Context["live"]> {
  return {
    ...livePresence,
    async ticket(session: Session) {
      const response = await call(hub(session.user.id), "/ticket", {
        sessionId: session.session.id,
        expiresAt: new Date(session.session.expiresAt).getTime(),
      });
      const { ticket } = (await response.json()) as { ticket: string };
      return { url: socketAddress(request.url, session.user.id, ticket) };
    },
  };
}
export const livePresence: Pick<NonNullable<Context["live"]>, "active" | "isActive"> = {
  async active(userId, sessionId, conversationId) {
    await call(hub(userId), "/active", { sessionId, conversationId });
  },
  async isActive(userId, sessionId, conversationId) {
    try {
      const response = await call(hub(userId), "/presence", { sessionId, conversationId });
      return ((await response.json()) as { active: boolean }).active;
    } catch {
      return false;
    } // Presence is advisory; outages must not silently drop alerts.
  },
};
export async function beginDispatch() {
  const id = crypto.randomUUID();
  await call(liveBindings().OUTBOX_CLOCK.getByName("outbox"), "/begin", { id });
  return async () => {
    await call(liveBindings().OUTBOX_CLOCK.getByName("outbox"), "/finish", { id });
  };
}
export async function recoverDispatch() {
  await call(liveBindings().OUTBOX_CLOCK.getByName("outbox"), "/finish", {});
}
