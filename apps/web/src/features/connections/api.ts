import { apiFetch } from "@/lib/desktop";
import { ENV } from "@/env.public";

const api = ENV.VITE_SERVER_URL.replace(/\/$/, "");

export type Permission = "read" | "write";
export type Connection = {
  clientId: string;
  name: string | null;
  logoUri: string | null;
  permission: Permission;
  connectedAt: string | null;
};
/** What the connecting app says about itself in its client metadata. */
export type ConnectingApp = { client_id: string; client_name?: string; logo_uri?: string };

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await apiFetch(`${api}/api/auth${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      // An expired or altered authorization request can only be started again by the app.
      result.error === "invalid_signature"
        ? "This request has expired. Start connecting again from the app."
        : result.message || result.error_description || "Could not complete that. Try again.",
    );
  return result as T;
}

export const connections = {
  /** With the URL people paste into an MCP client, which the server names: the desktop app
   * reaches the API on another host than the one its tokens are bound to. */
  list: () => request<{ mcpServerURL: string; connections: Connection[] }>("/connections"),
  revoke: (clientId: string) => request<{ success: true }>("/connections/revoke", { clientId }),
  app: (clientId: string) =>
    request<ConnectingApp>(`/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`),
  /**
   * Answers the authorization request the API signed into the connect page's query. Better
   * Auth returns where to send the browser next: back to the app with a code or an error.
   */
  answer: (signedQuery: string, accept: boolean, scope?: string) =>
    request<{ url: string }>("/oauth2/consent", { accept, scope, oauth_query: signedQuery }),
};

/** Logos come from the app's own metadata; only HTTPS addresses are shown. */
export function safeLogo(uri: string | null | undefined) {
  return uri?.startsWith("https://") ? uri : null;
}
