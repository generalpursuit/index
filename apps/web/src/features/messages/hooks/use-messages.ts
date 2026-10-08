import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
export function useConversations(query?: string) {
  const api = useAPI();
  return useInfiniteQuery(
    api.messages.conversations.infiniteOptions({
      input: (cursor: string | undefined) => ({ query, cursor, limit: 30 }),
      initialPageParam: undefined,
      getNextPageParam: (p) => p.nextCursor ?? undefined,
      refetchInterval: 10_000,
    }),
  );
}
export function useConversation(id: string) {
  const api = useAPI();
  const detail = useQuery(
    api.messages.conversation.queryOptions({
      input: { conversationId: id },
      refetchInterval: 10_000,
    }),
  );
  const list = useInfiniteQuery(
    api.messages.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ conversationId: id, cursor, limit: 30 }),
      initialPageParam: undefined,
      getNextPageParam: (p) => p.nextCursor ?? undefined,
      refetchInterval: 5_000,
    }),
  );
  return { detail, list };
}
export function useMessageActions() {
  const api = useAPI(),
    cache = useQueryClient();
  const refresh = () => cache.invalidateQueries({ queryKey: api.messages.key() });
  return {
    start: useMutation(api.messages.createConversation.mutationOptions({ onSuccess: refresh })),
    send: useMutation(api.messages.send.mutationOptions({ onSuccess: refresh })),
    read: useMutation(api.messages.markRead.mutationOptions({ onSuccess: refresh })),
  };
}
