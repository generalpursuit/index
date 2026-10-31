import type { Hono } from "hono";

export type AuthFactory = (
  backgroundTask: (task: Promise<unknown>) => void,
) => Promise<{ handler: (request: Request) => Promise<Response> }>;

/** Production HTTP boundary: recovery and retention tasks survive the Worker response. */
export function mountAuthentication(
  app: Hono,
  factory: AuthFactory,
  beginMutation?: () => Promise<() => Promise<void>>,
) {
  app.on(["POST", "GET"], "/api/auth/*", async (c) => {
    // Better Auth also owns session-revocation endpoints. Cover its whole write boundary.
    const writing = c.req.method === "POST";
    const finish = writing ? await beginMutation?.() : undefined;
    const auth = await factory((task) => c.executionCtx.waitUntil(task));
    try {
      return await auth.handler(c.req.raw);
    } finally {
      if (finish) c.executionCtx.waitUntil(finish());
    }
  });
}
