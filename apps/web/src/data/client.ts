import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const freshness = { live: Infinity, onShow: 30_000, stable: 5 * 60_000 };
export const cacheMaxAge = 7 * 24 * 60 * 60_000;

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if ("status" in error && [403, 404].includes(Number(error.status))) {
          // Keep observers and the permission error, but erase previously authorized content.
          query.setState({ data: undefined, dataUpdatedAt: 0 });
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (error.name !== "AbortError" && !mutation.options.meta?.inlineError)
          toast.error(error.message);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: freshness.onShow,
        gcTime: cacheMaxAge,
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

export const canPrefetch = () =>
  typeof navigator === "undefined" ||
  !(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
