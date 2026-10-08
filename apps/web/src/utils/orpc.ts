import type { AppRouterClient } from "@index/api/contracts";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { MutationCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ENV } from "../env.public";

export function createQueryClient() {
  return new QueryClient({
    mutationCache: new MutationCache({ onError: (error) => toast.error(error.message) }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, error) =>
          !("status" in error && [400, 401, 403, 404].includes(Number(error.status))) && count < 2,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}
export const queryClient = createQueryClient();
export const client: AppRouterClient = createORPCClient(
  new RPCLink({
    url: ENV.VITE_SERVER_URL.replace(/\/$/, "") + "/rpc/v1",
    fetch: (request, init) => fetch(request, { ...init, credentials: "include" }),
  }),
);
export const apiFor = (viewerId: string | null) =>
  createTanstackQueryUtils(client, { path: ["viewer", viewerId ?? "anonymous"] });
export const orpc = apiFor(null);
