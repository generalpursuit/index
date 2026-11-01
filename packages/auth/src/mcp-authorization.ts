import { cimd } from "@better-auth/cimd";
import { mcp } from "@better-auth/mcp";
import { APIError } from "better-auth/api";
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
 * page, which sends it through verification; it cannot approve until that succeeds. A DPoP
 * key thumbprint is ignored, as RFC 9449 lets a server without DPoP do (see `refuseDpop`).
 */
export function shapeAuthorizationRequest(
  params: Record<string, unknown>,
  apiURL: string,
  restricted: boolean,
) {
  const requested = typeof params.scope === "string" ? params.scope.split(" ") : [];
  params.scope = ["read", ...requested.filter((scope) => scope && scope !== "read")].join(" ");
  params.resource ??= mcpResource(apiURL);
  delete params.dpop_jkt;
  if (restricted) params.prompt = "consent";
}

/**
 * Index issues Bearer tokens only; the MCP specification doesn't require DPoP. Better Auth
 * would bind tokens to a client's DPoP key on request, and `verifyMcpAccess` checks no
 * proofs, so a stolen bound token would work without its key. Registrations that require
 * DPoP-bound tokens and token requests that carry a DPoP proof are refused.
 */
export function refuseDpop(path: string, headers: Headers | undefined, body: unknown) {
  const registration = body as { dpop_bound_access_tokens?: unknown } | undefined;
  if (path === "/oauth2/register" && registration?.dpop_bound_access_tokens === true)
    throw new APIError("BAD_REQUEST", {
      error: "invalid_client_metadata",
      error_description: "Index issues Bearer tokens only; DPoP-bound tokens are not supported.",
    });
  if (path === "/oauth2/token" && headers?.has("dpop"))
    throw new APIError("BAD_REQUEST", {
      error: "invalid_request",
      error_description: "Index issues Bearer tokens only; send the request without DPoP.",
    });
}

/** DPoP fields Better Auth adds to both discovery documents; Index doesn't offer DPoP. */
const dpopDiscoveryFields = [
  "dpop_signing_alg_values_supported",
  "dpop_bound_access_tokens_required",
];

/** An authorization-server or protected-resource metadata response without DPoP fields. */
export async function withoutDpopDiscovery(response: Response) {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
    return response;
  const body = await response.text();
  // A HEAD request's answer has no document to filter.
  if (!body) return new Response(null, response);
  const document = JSON.parse(body) as Record<string, unknown>;
  for (const field of dpopDiscoveryFields) delete document[field];
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return Response.json(document, { status: response.status, headers });
}
