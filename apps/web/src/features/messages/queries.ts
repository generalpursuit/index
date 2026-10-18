import type { QueryKey } from "@tanstack/react-query";
import { freshness } from "@/data/client";
import type { apiFor } from "@/utils/orpc";
type API = ReturnType<typeof apiFor>;
export const conversationsOptions = (api: API, query = "") =>
  api.messages.conversations.infiniteOptions({
    input: (cursor: string | undefined) => ({ query: query || undefined, cursor, limit: 30 }),
    initialPageParam: undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    staleTime: freshness.live,
  });
export const conversationOptions = (api: API, id: string) =>
  api.messages.conversation.queryOptions({
    input: { conversationId: id },
    staleTime: freshness.live,
  });
export const messagesOptions = (api: API, id: string) =>
  api.messages.list.infiniteOptions({
    input: (cursor: string | undefined) => ({ conversationId: id, cursor, limit: 30 }),
    initialPageParam: undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    staleTime: freshness.live,
  });
// Marks a message file query, in the place where other keys name their feature.
const filesSegment = "files";
/**
 * A sent file's bytes. They never change, so each is read once while cached. They are cached
 * under the viewer but outside the "messages" feature: cache edits walk that feature's data as
 * plain objects, and only content features are persisted. The key deliberately leaves out the
 * conversation, which is why it is cast: file IDs are unique, and the server checks membership
 * on every read.
 */
export function messageFileOptions(api: API, conversationId: string, fileId: string) {
  const input = { conversationId, fileId };
  const [[root, viewer]] = api.messages.file.queryKey({ input }) as unknown as [[string, string]];
  return api.messages.file.queryOptions({
    input,
    queryKey: [[root, viewer, filesSegment, fileId]] as unknown as ReturnType<
      typeof api.messages.file.queryKey
    >,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });
}
/** Whether a query holds a message file's bytes, which broad refreshes skip as they never change. */
export const isMessageFileQuery = (key: QueryKey) =>
  Array.isArray(key[0]) && key[0][2] === filesSegment;
