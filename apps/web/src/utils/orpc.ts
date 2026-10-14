import { apiFetch } from "@/lib/desktop";
import type { AppRouterClient } from "@index/api/contracts";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { ENV } from "../env.public";

export { createQueryClient, queryClient } from "@/data/client";
export const client: AppRouterClient = createORPCClient(
  new RPCLink({
    url: ENV.VITE_SERVER_URL.replace(/\/$/, "") + "/rpc/v1",
    fetch: apiFetch,
  }),
);
export const apiFor = (viewerId: string | null) =>
  createTanstackQueryUtils(client, { path: ["viewer", viewerId ?? "anonymous"] });
export const orpc = apiFor(null);
