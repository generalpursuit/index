import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";
import { listConnections, revokeConnection } from "./connections";

type DB = Pick<PgAsyncDatabase<PgQueryResultHKT>, "select" | "execute">;

/** Settings → Connections: the apps a verified user approved, and disconnecting one. */
export function connectionsPlugin(database: DB) {
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
          return { connections: await listConnections(database, ctx.context.session.user.id) };
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
