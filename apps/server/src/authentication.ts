import { clientOAuthPaths } from "@index/auth/mcp-authorization";
import type { Hono } from "hono";

export type AuthFactory = (
  backgroundTask: (task: Promise<unknown>) => void,
) => Promise<{ handler: (request: Request) => Promise<Response> }>;

// MCP clients discover the authorization server from the API origin's root (RFC 8414 and
// RFC 9728 put metadata for `/api/auth` and `/mcp` under `/.well-known/…/<path>`).
const discoveryPaths = [
  "/.well-known/oauth-authorization-server/api/auth",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
];

/**
 * Discovery documents and the token, registration and revocation endpoints are called by MCP
 * clients from any origin, without cookies.
 */
export function isClientOAuthPath(path: string) {
  return (
    discoveryPaths.includes(path) ||
    path.startsWith("/api/auth/.well-known/") ||
    (path.startsWith("/api/auth/") && clientOAuthPaths.has(path.slice("/api/auth".length)))
  );
}

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
  app.on("GET", discoveryPaths, async (c) => {
    const auth = await factory((task) => c.executionCtx.waitUntil(task));
    return auth.handler(c.req.raw);
  });
}
