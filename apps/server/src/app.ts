import type { Context as ApiContext } from "@index/api/context";
import { Hono } from "hono";
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
};

/** Mount the HTTP application; the Worker entrypoint supplies runtime services. */
export function createApp(options: AppOptions) {
  const app = new Hono();
  app.use(logger());
  app.use(
    "/*",
    cors({
      origin: options.origins,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", clientHeader],
      exposeHeaders: ["set-auth-token"],
      credentials: true,
    }),
  );
  app.use("/*", clientVersionGate);
  mountAuthentication(app, options.auth);
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
