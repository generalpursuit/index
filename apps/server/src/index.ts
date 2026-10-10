import { runNotifications } from "./notifications/worker";
import { trustedWebOrigins } from "@index/auth/origins";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { mountAuthentication } from "./authentication";
import { createContext } from "./context";
import { mediaCacheControl } from "./media";
import { desktopOrigins, ENV } from "./env.server";
import { createAuth } from "./services";
import { apiHandler, rpcHandler } from "./transport";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: [...trustedWebOrigins(ENV.CORS_ORIGIN, ENV.AUTH_TRUSTED_ORIGINS), ...desktopOrigins],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["set-auth-token"],
    credentials: true,
  }),
);

mountAuthentication(app, (backgroundTask) => createAuth(undefined, backgroundTask));

// Profile photos, straight from the bucket.
app.get("/media/*", async (c) => {
  const object = await ENV.MEDIA.get(c.req.path.slice("/media/".length));
  if (!object) return c.notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", mediaCacheControl);
  return new Response(object.body, { headers });
});

app.use("/*", async (c, next) => {
  const context = await createContext({ context: c });

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: c.req.path.startsWith("/rpc/v1/") ? "/rpc/v1" : "/rpc",
    context: context,
  });

  if (rpcResult.matched) {
    return c.newResponse(rpcResult.response.body, rpcResult.response);
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/api/v1",
    context: context,
  });

  if (apiResult.matched) {
    return c.newResponse(apiResult.response.body, apiResult.response);
  }

  await next();
});

app.get("/", (c) => {
  return c.text("OK");
});

// Postgres is the durable queue. Cron recovers interrupted delivery attempts.
export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, _env: unknown, ctx: ExecutionContext) {
    ctx.waitUntil(runNotifications());
  },
};
