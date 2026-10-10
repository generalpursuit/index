import type { Hono } from "hono";

/** Production HTTP boundary: recovery and retention tasks survive the Worker response. */
export function mountAuthentication(
  app: Hono,
  factory: (
    backgroundTask: (task: Promise<unknown>) => void,
  ) => Promise<{ handler: (request: Request) => Promise<Response> }>,
) {
  app.on(["POST", "GET"], "/api/auth/*", async (c) => {
    const auth = await factory((task) => c.executionCtx.waitUntil(task));
    return auth.handler(c.req.raw);
  });
}
