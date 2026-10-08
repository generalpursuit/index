import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
export function useDiscovery(query: string) {
  const api = useAPI();
  const suggested = useQuery(
    api.discovery.recommendations.queryOptions({ input: { limit: 30 }, enabled: !query }),
  );
  const search = useInfiniteQuery(
    api.discovery.searchUsers.infiniteOptions({
      input: (after: string | undefined) => ({ query, after, limit: 30 }),
      initialPageParam: undefined,
      getNextPageParam: (p) => p.nextAfter ?? undefined,
      enabled: !!query,
    }),
  );
  return { suggested, search };
}
