import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAPI, useViewer } from "@/hooks/use-api";
export function useActivity(type?: "comment" | "request" | "follow" | "accepted") {
  const api = useAPI(),
    cache = useQueryClient();
  const list = useInfiniteQuery(
    api.activity.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ type, cursor, limit: 30 }),
      initialPageParam: undefined,
      getNextPageParam: (p) => p.nextCursor ?? undefined,
      refetchInterval: 30_000,
    }),
  );
  const read = useMutation(
    api.activity.markRead.mutationOptions({
      onSuccess: () => cache.invalidateQueries({ queryKey: api.activity.key() }),
    }),
  );
  return { list, read };
}
export function useUnread() {
  const api = useAPI(),
    viewer = useViewer();
  const activity = useQuery(
    api.activity.list.queryOptions({
      input: { limit: 1 },
      enabled: !!viewer,
      refetchInterval: 30_000,
    }),
  );
  const messages = useQuery(
    api.messages.unread.queryOptions({ enabled: !!viewer, refetchInterval: 15_000 }),
  );
  return { activity: activity.data?.unreadCount ?? 0, messages: messages.data?.unreadCount ?? 0 };
}
