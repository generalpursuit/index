import { ENV } from "@/env.public";
import { apiFetch } from "@/lib/desktop";
import { accountGeneration, assertCurrentAccount } from "@/lib/account-boundary";
import type { AppRouterClient } from "@index/api/contracts";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { BatchLinkPlugin } from "@orpc/client/plugins";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

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
      url: ENV.VITE_SERVER_URL.replace(/\/$/, "") + "/rpc/v1",
      fetch: async (input, init) => {
        assertCurrentAccount(generation);
        const response = await apiFetch(input, init);
        assertCurrentAccount(generation);
        return response;
      },
      // A batch belongs to one accepted generation. Writes retain their individual retry identity.
      plugins: [
        new BatchLinkPlugin({
          groups: [{ condition: () => true, context: {} }],
          exclude: ({ path }) => !reads.has(path.at(-1)!),
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
export const apiFor = (viewerId: string | null) =>
  createTanstackQueryUtils(acceptedClient(), { path: ["viewer", viewerId ?? "anonymous"] });
export const orpc = apiFor(null);
