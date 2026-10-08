import { useInfiniteQuery } from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
export function useFeed(weekStart: string) {
  const api = useAPI();
  return useInfiniteQuery(
    api.feed.week.infiniteOptions({
      input: (after: string | undefined) => ({ weekStart, after, limit: 10, linkLimit: 20 }),
      initialPageParam: undefined,
      getNextPageParam: (p) => p.nextAfter ?? undefined,
    }),
  );
}
