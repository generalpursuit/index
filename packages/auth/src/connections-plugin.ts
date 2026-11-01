import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";
import { listConnections, mcpResource, revokeConnection } from "./connections";

type DB = Pick<PgAsyncDatabase<PgQueryResultHKT>, "select" | "execute">;

/**
 * Settings → Connections: the MCP server URL, the apps a verified user approved, and
 * disconnecting one. The URL is the stage's MCP resource, which tokens are bound to and clients
 * verify, whichever host the app itself reaches the API on.
 */
export function connectionsPlugin(database: DB, apiURL: string) {
  const requireVerified = (emailVerified: boolean) => {
    if (!emailVerified)
      throw new APIError("FORBIDDEN", {
        code: "EMAIL_NOT_VERIFIED",
        message: "Verify your email to continue.",
      });
  };
  return {
    id: "index-connections",
    endpoints: {
      listConnections: createAuthEndpoint(
        "/connections",
        { method: "GET", use: [sessionMiddleware] },
        async (ctx) => {
          requireVerified(ctx.context.session.user.emailVerified);
          return {
            mcpServerURL: mcpResource(apiURL),
            connections: await listConnections(database, ctx.context.session.user.id),
          };
        },
      ),
      revokeConnection: createAuthEndpoint(
        "/connections/revoke",
        {
          method: "POST",
          body: z.object({ clientId: z.string().min(1).max(2048) }),
          use: [sessionMiddleware],
        },
        async (ctx) => {
          requireVerified(ctx.context.session.user.emailVerified);
          await revokeConnection(database, ctx.context.session.user.id, ctx.body.clientId);
          return { success: true };
        },
      ),
    },
  };
}
