import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";

/**
 * Fetches Client ID Metadata Documents, and the key sets they name, for the CIMD plugin.
 *
 * Better Auth's Node transport resolves DNS once and pins the answer because a Node host can
 * reach private networks; checking DNS and then calling fetch would race a rebinding answer.
 * A Worker has no private network behind its egress: subrequests leave through Cloudflare's
 * edge to the public Internet, URLs naming an IP address are refused, and private networks are
 * reachable only through VPC bindings, which this Worker does not have. The remaining gap is
 * the Worker's own zone, which fetch routes straight to the zone's origin, past Workers and
 * Cloudflare's security settings. The `global_fetch_strictly_public` compatibility flag in
 * `packages/infra/alchemy.run.ts` closes it by routing every request as if it came from the
 * Internet, as Cloudflare's own `workers-oauth-provider` requires for CIMD.
 *
 * What is left for the transport is to send only plain HTTPS reads and never follow a redirect
 * to a destination the plugin did not validate. Workers reject `redirect: "error"`, which the
 * plugin asks for, so redirects are returned unfollowed and the plugin refuses the non-200.
 */
export function clientMetadataTransport(send: typeof fetch = fetch): ClientMetadataResourceFetch {
  return (input, init) => {
    const request = new Request(input, { ...init, redirect: "manual" });
    if (new URL(request.url).protocol !== "https:")
      throw new TypeError("Client metadata is only fetched over HTTPS.");
    if (request.method !== "GET" && request.method !== "HEAD")
      throw new TypeError("Client metadata is only read with GET or HEAD.");
    return send(request);
  };
}
