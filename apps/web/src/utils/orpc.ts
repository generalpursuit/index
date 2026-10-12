import { apiFetch } from "@/lib/desktop";
import type { AppRouterClient } from "@index/api/contracts";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { MutationCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ENV } from "../env.public";

export function createQueryClient() {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error) => {
        if (error.name !== "AbortError") toast.error(error.message);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Windows stay open for days (closing the desktop window only hides it), so keep what
        // was loaded instead of loading it again; stale data still refreshes when shown.
        gcTime: 24 * 60 * 60_000,
        retry: (count, error) =>
          !("status" in error && [400, 401, 403, 404, 426].includes(Number(error.status))) &&
          count < 2,
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
    fetch: apiFetch,
  }),
);
export const apiFor = (viewerId: string | null) =>
  createTanstackQueryUtils(client, { path: ["viewer", viewerId ?? "anonymous"] });
export const orpc = apiFor(null);
