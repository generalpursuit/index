import type { Context as ApiContext } from "@index/api/context";
import { maxFileBytes } from "@index/api/features/messages/files";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { mountAuthentication, type AuthFactory } from "./authentication";
import { clientHeader, clientVersionGate } from "./client-version";
import { apiHandler, rpcHandler } from "./transport";

type BackgroundTask = (task: Promise<unknown>) => void;
export type AppOptions = {
  origins: string[];
  auth: AuthFactory;
  createContext: (request: Request, backgroundTask: BackgroundTask) => Promise<ApiContext>;
  readMedia: (key: string) => Promise<Response | null>;
  beginMutation?: () => Promise<() => Promise<void>>;
  connect?: (userId: string, request: Request) => Promise<Response>;
};

// Both transports' upload routes. The RPC matcher ignores the method, and the REST matcher
// accepts an empty conversation segment and any number of trailing slashes, so the path alone
// decides.
const uploadPath = /^\/(?:rpc(?:\/v1)?\/messages\/upload|api\/v1\/conversations\/[^/]*\/files)\/*$/;

/** Mount the HTTP application; the Worker entrypoint supplies runtime services. */
export function createApp(options: AppOptions) {
  const app = new Hono();
  // Never log the one-use WebSocket ticket in its URL.
  app.use("/*", (c, next) => (c.req.path.startsWith("/live/") ? next() : logger()(c, next)));
  // Members share arbitrary files; a response is only ever the type it declares.
  app.use("/*", async (c, next) => {
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
  });
  app.use(
    "/*",
    cors({
      origin: options.origins,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", clientHeader, "X-ORPC-Batch"],
      exposeHeaders: ["set-auth-token"],
      credentials: true,
    }),
  );
  app.use("/*", clientVersionGate);
  app.get("/live/:account", (c) => {
    const origin = c.req.header("Origin");
    if (origin && !options.origins.includes(origin)) return c.body(null, 403);
    if (!options.connect || c.req.header("Upgrade")?.toLowerCase() !== "websocket")
      return c.notFound();
    return options.connect(c.req.param("account"), c.req.raw);
  });
  mountAuthentication(app, options.auth, options.beginMutation);
  // The schema's file limit applies only after a whole upload is in memory, so the body is
  // capped first. The extra megabyte allows for multipart framing.
  const capUpload = bodyLimit({
    maxSize: maxFileBytes + 1_000_000,
    onError: (c) =>
      c.json(
        {
          code: "PAYLOAD_TOO_LARGE",
          message: `Files can be at most ${maxFileBytes / 1_000_000} MB.`,
        },
        413,
      ),
  });
  app.use("/*", (c, next) => (uploadPath.test(c.req.path) ? capUpload(c, next) : next()));
  app.get(
    "/media/*",
    async (c) => (await options.readMedia(c.req.path.slice("/media/".length))) ?? c.notFound(),
  );
  app.use("/*", async (c, next) => {
    const path = c.req.path;
    const rpc = path === "/rpc" || path.startsWith("/rpc/");
    const api = path === "/api/v1" || path.startsWith("/api/v1/");
    if (!rpc && !api) return next();

    const context = await options.createContext(c.req.raw, (task) =>
      c.executionCtx.waitUntil(task),
    );
    const result = rpc
      ? await rpcHandler.handle(c.req.raw, {
          prefix: path === "/rpc/v1" || path.startsWith("/rpc/v1/") ? "/rpc/v1" : "/rpc",
          context,
        })
      : await apiHandler.handle(c.req.raw, { prefix: "/api/v1", context });
    if (result.matched) return c.newResponse(result.response.body, result.response);
    return next();
  });
  app.get("/", (c) => c.text("OK"));
  return app;
}
