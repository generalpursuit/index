import {
  oauthAccessToken,
  oauthClient,
  oauthCodeApproval,
  oauthConsent,
} from "@index/db/schema/oauth";
import { user } from "@index/db/schema/auth";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * What a connected app may do as its user. `read` reads everything the user can see through
 * Index; `write` also acts as the user (save, edit, comment, forward). Every grant includes
 * read, so a write grant is always read + write.
 */
export type Permission = "read" | "write";

/**
 * OAuth scopes: the two permissions, and `offline_access` for refresh tokens, which every grant
 * includes (see `shapeAuthorizationRequest`).
 */
export const connectionScopes = ["read", "write", "offline_access"];

/** Prefixes make Index tokens recognizable to people and secret scanners. They aren't stored. */
export const tokenPrefixes = { opaqueAccessToken: "index_at_", refreshToken: "index_rt_" };

/** The protected MCP resource of a stage: every connection token is bound to it. */
export function mcpResource(apiURL: string) {
  return new URL("/mcp", apiURL).href;
}

/** Tokens and authorization codes are stored only as this digest. */
export async function digestToken(token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Buffer.from(bytes).toString("base64url");
}

/** The permissions in a set of granted scopes; write implies read, nothing grants nothing. */
export function permissionsOf(scopes: readonly string[]): Permission[] {
  if (scopes.includes("write")) return ["read", "write"];
  return scopes.includes("read") ? ["read"] : [];
}

type DB = Pick<PgAsyncDatabase<PgQueryResultHKT>, "select" | "execute">;

export type McpAccess = {
  /** The Index account the agent acts for. */
  userId: string;
  /** Always includes `read`; includes `write` only when the user granted it. */
  permissions: Permission[];
  /** The connected app: an HTTPS URL for metadata-document clients, an opaque ID otherwise. */
  client: { id: string; name: string | null };
};

/**
 * Authorizes a request to the MCP endpoint from its `Authorization: Bearer` access token
 * (or the token itself). Returns null unless the token was issued for this stage's MCP
 * resource, is unexpired and unrevoked, bound to no key (Index has no DPoP, so a key-bound
 * token must not count as Bearer), its app is enabled and still connected, and its account
 * still exists with a verified email. A token counts only under the approval its code was
 * issued under, never another approval of the same app (see `oauthCodeApproval`). Permissions
 * are those of both the token and that approval, so a narrower re-approval also narrows
 * tokens issued before it.
 *
 * Every call reads the database: revoking a connection stops the agent's next request.
 */
export async function verifyMcpAccess(
  database: DB,
  apiURL: string,
  credential: Request | string,
): Promise<McpAccess | null> {
  const token =
    typeof credential === "string"
      ? credential
      : /^Bearer (\S+)$/i.exec(credential.headers.get("authorization") ?? "")?.[1];
  if (!token?.startsWith(tokenPrefixes.opaqueAccessToken)) return null;
  const [row] = await database
    .select({
      userId: oauthConsent.userId,
      tokenScopes: oauthAccessToken.scopes,
      grantedScopes: oauthConsent.scopes,
      clientId: oauthClient.clientId,
      clientName: oauthClient.name,
    })
    .from(oauthAccessToken)
    .innerJoin(
      oauthCodeApproval,
      eq(oauthCodeApproval.codeId, oauthAccessToken.authorizationCodeId),
    )
    .innerJoin(oauthConsent, eq(oauthConsent.id, oauthCodeApproval.consentId))
    .innerJoin(user, and(eq(user.id, oauthConsent.userId), eq(user.emailVerified, true)))
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(
      and(
        eq(oauthAccessToken.userId, oauthConsent.userId),
        eq(oauthAccessToken.clientId, oauthConsent.clientId),
        eq(
          oauthAccessToken.token,
          await digestToken(token.slice(tokenPrefixes.opaqueAccessToken.length)),
        ),
        gt(oauthAccessToken.expiresAt, new Date()),
        isNull(oauthAccessToken.revoked),
        isNull(oauthAccessToken.confirmation),
        sql`${mcpResource(apiURL)} = ANY(${oauthAccessToken.resources})`,
        sql`${oauthClient.disabled} IS NOT TRUE`,
      ),
    )
    .limit(1);
  if (!row?.userId) return null;
  const permissions = permissionsOf(
    row.tokenScopes.filter((scope) => row.grantedScopes.includes(scope)),
  );
  if (!permissions.length) return null;
  return { userId: row.userId, permissions, client: { id: row.clientId, name: row.clientName } };
}

export type Connection = {
  clientId: string;
  name: string | null;
  /** The app's self-declared logo; only HTTPS addresses are passed on. */
  logoUri: string | null;
  permission: Permission;
  connectedAt: string | null;
};

/** The apps a user has approved, newest first. */
export async function listConnections(database: DB, userId: string): Promise<Connection[]> {
  const rows = await database
    .select({
      clientId: oauthConsent.clientId,
      scopes: oauthConsent.scopes,
      connectedAt: oauthConsent.createdAt,
      name: oauthClient.name,
      icon: oauthClient.icon,
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, userId))
    .orderBy(desc(oauthConsent.createdAt), desc(oauthConsent.id));
  return rows.map((row) => ({
    clientId: row.clientId,
    name: row.name,
    logoUri: row.icon?.startsWith("https://") ? row.icon : null,
    permission: permissionsOf(row.scopes).includes("write") ? "write" : "read",
    connectedAt: row.connectedAt?.toISOString() ?? null,
  }));
}

/**
 * Disconnects an app: deleting its approval deletes the pending codes and every token issued
 * under it, and no exchange or refresh already in flight can issue another.
 */
export async function revokeConnection(database: DB, userId: string, clientId: string) {
  await database.execute(sql`
    DELETE FROM ${oauthConsent}
    WHERE ${oauthConsent.userId} = ${userId} AND ${oauthConsent.clientId} = ${clientId}`);
}
