import { DurableObject } from "cloudflare:workers";

type Attachment = {
  sessionId: string;
  expiresAt: number;
  conversationId: string | null;
  activeUntil: number;
};
type Ticket = { sessionId: string; expiresAt: number; redeemUntil: number };
export class AccountHub extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const key = `ticket:${url.searchParams.get("ticket") ?? ""}`;
      const ticket = await this.ctx.storage.transaction(async (tx) => {
        const value = await tx.get<Ticket>(key);
        await tx.delete(key);
        return value;
      });
      if (!ticket || ticket.redeemUntil <= Date.now() || ticket.expiresAt <= Date.now())
        return new Response(null, { status: 401 });
      const pair = new WebSocketPair();
      pair[1].serializeAttachment({ ...ticket, conversationId: null, activeUntil: 0 });
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify({ type: "change" })); // Reconcile missed hints on every connection.
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    const body = (await request.json()) as Record<string, unknown>;
    if (url.pathname === "/ticket") {
      if (typeof body.sessionId !== "string" || typeof body.expiresAt !== "number")
        return new Response(null, { status: 400 });
      const outstanding = await this.ctx.storage.list<Ticket>({ prefix: "ticket:" });
      for (const [key, ticket] of outstanding)
        if (ticket.redeemUntil <= Date.now()) await this.ctx.storage.delete(key);
      if ([...outstanding.values()].filter((t) => t.redeemUntil > Date.now()).length >= 64)
        return new Response(null, { status: 429 });
      const ticket = crypto.randomUUID();
      await this.ctx.storage.put(`ticket:${ticket}`, {
        sessionId: body.sessionId,
        expiresAt: Math.min(body.expiresAt, Date.now() + 86_400_000),
        redeemUntil: Date.now() + 60_000,
      });
      return Response.json({ ticket });
    }
    if (url.pathname === "/notify") {
      if (body.sessionChanged) {
        const tickets = await this.ctx.storage.list({ prefix: "ticket:" });
        await this.ctx.storage.delete([...tickets.keys()]);
        await this.ctx.storage.delete("legacy-presence");
      }
      for (const socket of this.ctx.getWebSockets()) {
        const state = socket.deserializeAttachment() as Attachment;
        try {
          if (body.sessionChanged || state.expiresAt <= Date.now())
            socket.close(4001, "Revalidate session");
          else socket.send(JSON.stringify({ type: "change" }));
        } catch {
          socket.close(1011, "Connection interrupted");
        }
      }
      return Response.json({ success: true });
    }
    if (url.pathname === "/active") {
      // Older releases publish focus through HTTP. Keep their short lease at the edge too.
      const legacy =
        (await this.ctx.storage.get<Record<string, { conversationId: string; until: number }>>(
          "legacy-presence",
        )) ?? {};
      for (const [id, presence] of Object.entries(legacy))
        if (presence.until <= Date.now()) delete legacy[id];
      if (typeof body.sessionId === "string") {
        if (typeof body.conversationId === "string")
          legacy[body.sessionId] = {
            conversationId: body.conversationId,
            until: Date.now() + 90_000,
          };
        else delete legacy[body.sessionId];
      }
      await this.ctx.storage.put("legacy-presence", legacy);
      for (const socket of this.ctx.getWebSockets()) {
        const state = socket.deserializeAttachment() as Attachment;
        if (state.sessionId === body.sessionId) this.presence(socket, state, body.conversationId);
      }
      return Response.json({ success: true });
    }
    if (url.pathname === "/presence") {
      const legacy =
        await this.ctx.storage.get<Record<string, { conversationId: string; until: number }>>(
          "legacy-presence",
        );
      const prior = typeof body.sessionId === "string" ? legacy?.[body.sessionId] : undefined;
      return Response.json({
        active:
          (prior && prior.until > Date.now() && prior.conversationId === body.conversationId) ||
          this.ctx.getWebSockets().some((socket) => {
            const state = socket.deserializeAttachment() as Attachment;
            return (
              state.sessionId === body.sessionId &&
              state.expiresAt > Date.now() &&
              state.activeUntil > Date.now() &&
              state.conversationId === body.conversationId
            );
          }),
      });
    }
    return new Response(null, { status: 404 });
  }
  private presence(socket: WebSocket, state: Attachment, conversationId: unknown) {
    state.conversationId =
      typeof conversationId === "string" && /^[0-9a-f-]{36}$/i.test(conversationId)
        ? conversationId
        : null;
    state.activeUntil = Date.now() + 90_000;
    socket.serializeAttachment(state);
  }
  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const state = socket.deserializeAttachment() as Attachment;
    if (state.expiresAt <= Date.now()) {
      socket.close(4001, "Revalidate session");
      return;
    }
    if (typeof message !== "string" || message.length > 256) {
      socket.close(1008, "Invalid frame");
      return;
    }
    try {
      const body = JSON.parse(message) as { type?: string; conversationId?: unknown };
      if (body.type === "presence") this.presence(socket, state, body.conversationId);
    } catch {
      socket.close(1008, "Invalid frame");
    }
  }
  webSocketClose(socket: WebSocket, code: number) {
    socket.close(code === 1006 ? 1000 : code);
  }
  webSocketError(socket: WebSocket) {
    socket.close(1011, "Connection interrupted");
  }
}
