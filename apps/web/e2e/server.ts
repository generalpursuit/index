import { z } from "zod";
import { fetchPage, seedFixture, type Registration } from "./fixtures.ts";
import type { SecurityEmail } from "../../../packages/auth/src/delivery.ts";
import { deliverBatch } from "../../../packages/api/src/features/notifications/delivery.ts";
import { apiURL, webURL } from "./urls.ts";
import { createTestDatabase } from "../../../packages/api/src/testing/database.ts";
import { createAuth } from "../../../packages/auth/src/index.ts";
import { createRouterClient } from "@orpc/server";
import { appRouter } from "../../../packages/api/src/routers/index.ts";
import { clientHeader } from "../../server/src/client-version.ts";
import { apiHandler, rpcHandler } from "../../server/src/transport.ts";
import { memoryMediaStore } from "../../../packages/api/src/features/profiles/media.ts";
const database = await createTestDatabase();
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
Bun.serve({
  hostname: "127.0.0.1",
  port: Number(new URL(apiURL).port),
  async fetch(request) {
    const url = new URL(request.url);
    let response;
    if (request.method === "OPTIONS") response = new Response(null, { status: 204 });
    else if (url.pathname === "/_test/reset" && request.method === "POST") {
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
      const result = await rpcHandler.handle(request, {
        prefix: "/rpc/v1",
        context: { db: database.db, session, fetchPage, media, notifications },
      });
      const rest = result.matched
        ? result
        : await apiHandler.handle(request, {
            prefix: "/api/v1",
            context: { db: database.db, session, fetchPage, media, notifications },
          });
      response = rest.response ?? new Response("Not found", { status: 404 });
    }
    const headers = new Headers(response.headers);
    const origin = request.headers.get("origin");
    if (origin && [webURL, "tauri://localhost", "http://tauri.localhost"].includes(origin))
      headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Expose-Headers", "set-auth-token");
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Headers", `Content-Type,Authorization,${clientHeader}`);
    headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    return new Response(response.body, { status: response.status, headers });
  },
});
console.log(`Isolated browser-test API ready on ${apiURL}`);
