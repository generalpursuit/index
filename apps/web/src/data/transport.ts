import { ENV } from "@/env.public";
import { apiFetch, notifySessionEvent } from "@/lib/desktop";
import { accountGeneration, assertCurrentAccount } from "@/lib/account-boundary";
import type { AppRouterClient } from "@index/api/contracts";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { BatchLinkPlugin } from "@orpc/client/plugins";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { failedWith } from "./errors";

const reads = new Set([
  "get",
  "me",
  "list",
  "week",
  "weeks",
  "listByOwner",
  "listMine",
  "listInGroup",
  "followers",
  "following",
  "requests",
  "recommendations",
  "searchUsers",
  "conversations",
  "conversation",
  "unread",
  "resolve",
  "preferences",
  "capabilities",
]);
let active: { generation: number; client: AppRouterClient } | undefined;
function acceptedClient() {
  const generation = accountGeneration();
  if (active?.generation === generation) return active.client;
  const client: AppRouterClient = createORPCClient(
    new RPCLink({
      origin: ENV.VITE_SERVER_URL,
      url: "/rpc/v1",
      interceptors: [
        async ({ next }) => {
          assertCurrentAccount(generation);
          try {
            const result = await next();
            assertCurrentAccount(generation);
            return result;
          } catch (error) {
            assertCurrentAccount(generation);
            // Any 401 ends the session, including one without an oRPC error body.
            if (failedWith(error, 401)) notifySessionEvent("index:session-expired");
            else if (
              error instanceof ORPCError &&
              error.code === "FORBIDDEN" &&
              (error.data as { code?: string } | undefined)?.code === "EMAIL_NOT_VERIFIED"
            )
              notifySessionEvent("index:verification-required");
            assertCurrentAccount(generation);
            throw error;
          }
        },
      ],
      fetch: async (url, init) => {
        assertCurrentAccount(generation);
        const response = await apiFetch(url, init);
        assertCurrentAccount(generation);
        return response;
      },
      // A batch belongs to one accepted generation. Writes retain their individual retry identity.
      plugins: [
        new BatchLinkPlugin({
          mode: "streaming",
          groups: [{ condition: () => true, context: {} }],
          filter: ({ path }) => reads.has(path.at(-1)!),
        }),
      ],
    }),
  );
  active = { generation, client };
  return client;
}
export const client = new Proxy({} as AppRouterClient, {
  get: (_target, feature: keyof AppRouterClient) => acceptedClient()[feature],
});
// Query keys start with the path `["viewer", id, ...procedure]`, which the cache code reads.
// oRPC's `prefix` option would add a separate string element instead.
export const apiFor = (viewerId: string | null) => {
  const viewer = viewerId ?? "anonymous";
  const clients: { viewer: Record<string, AppRouterClient> } = {
    viewer: { [viewer]: acceptedClient() },
  };
  return createTanstackQueryUtils(clients).viewer[viewer]!;
};
export const orpc = apiFor(null);
