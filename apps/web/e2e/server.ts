import { z } from "zod";
import { fetchImport, fetchPage, seedFixture, type Registration } from "./fixtures.ts";
import type { SecurityEmail } from "../../../packages/auth/src/delivery.ts";
import { deliverBatch } from "../../../packages/api/src/features/notifications/delivery.ts";
import { apiURL, webURL } from "./urls.ts";
import { createTestDatabase, files } from "../../../packages/api/src/testing/database.ts";
import { createAuth } from "../../../packages/auth/src/index.ts";
import { createRouterClient } from "@orpc/server";
import { appRouter } from "../../../packages/api/src/routers/index.ts";
import { clientHeader } from "../../server/src/client-version.ts";
import { apiHandler, rpcHandler } from "../../server/src/transport.ts";
import { memoryMediaStore } from "../../../packages/api/src/features/profiles/media.ts";
import type { Context } from "../../../packages/api/src/context.ts";
import * as liveRepository from "../../../packages/api/src/features/live/repository.ts";
const database = await createTestDatabase();
type LivePeer = {
  userId: string;
  sessionId: string;
  expiresAt: number;
  conversationId: string | null;
  activeUntil: number;
};
const peers = new Set<import("bun").ServerWebSocket<LivePeer>>();
const tickets = new Map<string, LivePeer & { redeemUntil: number }>();
const live: NonNullable<Context["live"]> = {
  async ticket(session) {
    const ticket = crypto.randomUUID();
    tickets.set(ticket, {
      userId: session.user.id,
      sessionId: session.session.id,
      expiresAt: new Date(session.session.expiresAt).getTime(),
      redeemUntil: Date.now() + 60_000,
      conversationId: null,
      activeUntil: 0,
    });
    return { url: `${apiURL.replace(/^http/, "ws")}/live/${session.user.id}?ticket=${ticket}` };
  },
  async active(userId, sessionId, conversationId) {
    for (const peer of peers)
      if (peer.data.userId === userId && peer.data.sessionId === sessionId) {
        peer.data.conversationId = conversationId;
        peer.data.activeUntil = Date.now() + 90_000;
      }
  },
  async isActive(userId, sessionId, conversationId) {
    return [...peers].some(
      ({ data }) =>
        data.userId === userId &&
        data.sessionId === sessionId &&
        data.expiresAt > Date.now() &&
        data.activeUntil > Date.now() &&
        data.conversationId === conversationId,
    );
  },
};
async function flushLive() {
  for (const row of await liveRepository.changes(database.db, 1000)) {
    for (const peer of peers)
      if (peer.data.userId === row.userId) {
        if (row.sessionChanged) peer.close(4001, "Revalidate session");
        else peer.send('{"type":"change"}');
      }
    await liveRepository.acknowledge(database.db, row.userId, row.version);
  }
}
// Isolated public key only; browser notification tests stub the push provider.
const pushKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const vapidPublicKey = Buffer.from(
  await crypto.subtle.exportKey("raw", pushKey.publicKey),
).toString("base64url");
const notifications = {
  web: true,
  apns: false,
  apnsEnvironment: null,
  desktop: true,
  vapidPublicKey,
};
const emails: SecurityEmail[] = [];
const deliveries: Promise<unknown>[] = [];
let failEmails = false;
const auth = createAuth(
  {
    BETTER_AUTH_URL: apiURL,
    BETTER_AUTH_SECRET: "isolated-playwright-only-secret-32-characters",
    CORS_ORIGIN: webURL,
  },
  database.db,
  ["tauri://localhost", "http://tauri.localhost"],
  {
    sendEmail: async (message) => {
      if (failEmails) throw new Error("Fixture delivery unavailable");
      emails.push(message);
    },
    backgroundTask: (task) => deliveries.push(task),
  },
);
async function registerFixture({ body }: Registration) {
  const response = await auth.handler(
    new Request(apiURL + "/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  if (!response.ok) throw new Error("Fixture signup failed");
  const result = z.object({ user: z.object({ id: z.string() }) }).parse(await response.json());
  const verified = await auth.handler(
    new Request(apiURL + "/api/auth/security/verify-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${response.headers.get("set-auth-token")}`,
      },
      body: JSON.stringify({ code: emails.findLast((message) => message.to === body.email)?.code }),
    }),
  );
  if (!verified.ok) throw new Error("Fixture verification failed");
  return result;
}
async function seed() {
  await Promise.all(deliveries);
  deliveries.length = 0;
  emails.length = 0;
  failEmails = false;
  return seedFixture(database, registerFixture);
}
let fixture = await seed();
// Uploaded photos stay in memory, served at `/media/*` like the bucket on the real server.
const media = memoryMediaStore(apiURL);
Bun.serve<LivePeer>({
  hostname: "127.0.0.1",
  port: Number(new URL(apiURL).port),
  websocket: {
    open(peer) {
      peers.add(peer);
      peer.send('{"type":"change"}');
    },
    close(peer) {
      peers.delete(peer);
    },
    message(peer, frame) {
      if (peer.data.expiresAt <= Date.now()) {
        peer.close(4001);
        return;
      }
      if (String(frame) === "ping") {
        peer.send("pong");
        return;
      }
      try {
        const value = JSON.parse(String(frame));
        if (value.type === "presence") {
          peer.data.conversationId =
            typeof value.conversationId === "string" ? value.conversationId : null;
          peer.data.activeUntil = Date.now() + 90_000;
        }
      } catch {
        peer.close(1008);
      }
    },
  },
  async fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/live/")) {
      const proof = url.searchParams.get("ticket") ?? "";
      const ticket = tickets.get(proof);
      tickets.delete(proof);
      const origin = request.headers.get("origin");
      if (origin && ![webURL, "tauri://localhost", "http://tauri.localhost"].includes(origin))
        return new Response(null, { status: 403 });
      if (
        !ticket ||
        ticket.redeemUntil <= Date.now() ||
        ticket.expiresAt <= Date.now() ||
        url.pathname !== `/live/${ticket.userId}`
      )
        return new Response(null, { status: 401 });
      return server.upgrade(request, { data: ticket })
        ? undefined
        : new Response(null, { status: 400 });
    }
    let response;
    if (request.method === "OPTIONS") response = new Response(null, { status: 204 });
    else if (url.pathname === "/_test/reset" && request.method === "POST") {
      for (const peer of peers) peer.close(4001);
      tickets.clear();
      fixture = await seed();
      response = Response.json(fixture);
    } else if (url.pathname === "/_test/notify" && request.method === "POST") {
      const actor = createRouterClient(appRouter, {
        context: database.context(fixture.people.Bob),
      });
      await actor.messages.send({
        conversationId: fixture.conversationId,
        clientId: crypto.randomUUID(),
        body: "PRIVATE browser fixture",
      });
      const ids: string[] = [];
      await deliverBatch(database.db, async (_device, alert) => {
        ids.push(alert.id);
        return { status: "sent" };
      });
      response = Response.json({ ids });
    } else if (url.pathname === "/_test/mail") {
      await Promise.all(deliveries);
      response = Response.json(
        emails.filter((message) => message.to === url.searchParams.get("email")),
      );
    } else if (url.pathname === "/_test/auth-clock" && request.method === "POST") {
      await database.client.exec(
        "UPDATE auth_challenge SET sent_at=now()-interval '61 seconds'; UPDATE auth_throttle SET expires_at=now()-interval '1 second'",
      );
      response = Response.json({ success: true });
    } else if (url.pathname === "/_test/email-failure" && request.method === "POST") {
      failEmails =
        z.object({ enabled: z.unknown().optional() }).parse(await request.json()).enabled === true;
      response = Response.json({ success: true });
    } else if (url.pathname === "/_test/fixture") response = Response.json(fixture);
    else if (url.pathname === "/health") response = new Response("ready");
    else if (url.pathname.startsWith("/media/")) {
      const object = media.get(url.pathname.slice("/media/".length));
      response = object
        ? new Response(new Uint8Array(object.body), {
            headers: {
              "content-type": object.contentType,
              "cache-control": "public, max-age=31536000, immutable",
            },
          })
        : new Response("Not found", { status: 404 });
    } else if (url.pathname.startsWith("/api/auth/")) response = await auth.handler(request);
    else {
      const session = await auth.api.getSession({ headers: request.headers });
      const context = {
        db: database.db,
        session,
        fetchPage,
        fetchImport,
        media,
        files,
        notifications,
        live,
      };
      const result = await rpcHandler.handle(request, { prefix: "/rpc/v1", context });
      const rest = result.matched
        ? result
        : await apiHandler.handle(request, { prefix: "/api/v1", context });
      response = rest.response ?? new Response("Not found", { status: 404 });
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) await flushLive();
    const headers = new Headers(response.headers);
    const origin = request.headers.get("origin");
    if (origin && [webURL, "tauri://localhost", "http://tauri.localhost"].includes(origin))
      headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Expose-Headers", "set-auth-token");
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set(
      "Access-Control-Allow-Headers",
      `Content-Type,Authorization,${clientHeader},X-ORPC-Batch`,
    );
    headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    return new Response(response.body, { status: response.status, headers });
  },
});
console.log(`Isolated browser-test API ready on ${apiURL}`);
