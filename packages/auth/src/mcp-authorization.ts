import { cimd } from "@better-auth/cimd";
import { mcp } from "@better-auth/mcp";
import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { clientMetadataTransport } from "./client-metadata-transport";
import { connectionScopes, digestToken, mcpResource, tokenPrefixes } from "./connections";
import { connectionsPlugin } from "./connections-plugin";

type DB = Pick<PgAsyncDatabase<PgQueryResultHKT>, "select" | "execute">;

/**
 * OAuth endpoints MCP clients call directly, possibly from a browser on any origin. They act
 * on client credentials, codes and tokens only, never on a cookie session.
 */
export const clientOAuthPaths = new Set(["/oauth2/token", "/oauth2/register", "/oauth2/revoke"]);

/** Endpoints of the authorization flow and connection management that Index exposes. */
export const mcpAuthorizationPaths = new Set([
  ...clientOAuthPaths,
  "/oauth2/authorize",
  "/oauth2/consent",
  "/oauth2/public-client",
  "/connections",
  "/connections/revoke",
]);

/**
 * Better Auth as the stage's MCP authorization server. Issuer, resource and the web consent
 * page all derive from the configured API and web origins.
 *
 * Access tokens are opaque and stored as digests, so every MCP request is checked against
 * the database and a revoked connection stops at once (see `verifyMcpAccess`). Clients
 * register through Client ID Metadata Documents, or unauthenticated dynamic registration
 * as the fallback older clients need.
 */
export function mcpAuthorizationPlugins(apiURL: string, webURL: string, database: DB) {
  const connectPage = new URL("/connect", webURL).href;
  return [
    mcp({
      resource: mcpResource(apiURL),
      loginPage: connectPage,
      consentPage: connectPage,
      scopes: connectionScopes,
      grantTypes: ["authorization_code", "refresh_token"],
      disableJwtPlugin: true,
      storeTokens: { hash: digestToken },
      prefix: tokenPrefixes,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // Native clients such as Cursor omit application_type for loopback callbacks.
      clientRegistrationDefaultApplicationType: "infer",
    }),
    cimd({
      fetchClientMetadataResource: clientMetadataTransport(),
      metadataProfile: "mcp-2026-07-28",
    }),
    connectionsPlugin(database),
  ];
}

/**
 * Shapes an authorization request before Better Auth reads it: every grant includes read,
 * and a client that omits the resource indicator still receives a token bound to the MCP
 * resource. A restricted session (signed in, email unverified) always reaches the consent
 * page, which sends it through verification; it cannot approve until that succeeds.
 */
export function shapeAuthorizationRequest(
  params: Record<string, unknown>,
  apiURL: string,
  restricted: boolean,
) {
  const requested = typeof params.scope === "string" ? params.scope.split(" ") : [];
  params.scope = ["read", ...requested.filter((scope) => scope && scope !== "read")].join(" ");
  params.resource ??= mcpResource(apiURL);
  if (restricted) params.prompt = "consent";
}
