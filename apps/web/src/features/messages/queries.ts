import type { apiFor } from "@/utils/orpc";
type API = ReturnType<typeof apiFor>;
export const conversationsOptions = (api: API, query = "") =>
  api.messages.conversations.infiniteOptions({
    input: (cursor: string | undefined) => ({ query: query || undefined, cursor, limit: 30 }),
    initialPageParam: undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: 10_000,
  });
export const conversationOptions = (api: API, id: string) =>
  api.messages.conversation.queryOptions({
    input: { conversationId: id },
    refetchInterval: 10_000,
  });
export const messagesOptions = (api: API, id: string) =>
  api.messages.list.infiniteOptions({
    input: (cursor: string | undefined) => ({ conversationId: id, cursor, limit: 30 }),
    initialPageParam: undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: 5_000,
  });
