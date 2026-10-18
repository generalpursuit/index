import { acknowledgeConversation } from "../edits";
import type { MessageAttempt } from "../draft";
import { instantEdit, mapItems, viewerPath } from "@/data/edits";
import { seedConversation } from "@/data/seeding";
import { useViewer } from "@/hooks/use-api";
import type { Message } from "@/lib/types";
import { accountMutationOptions } from "@/lib/account-boundary";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
import { conversationsOptions, conversationOptions, messagesOptions } from "../queries";
export function useConversations(query?: string) {
  return useInfiniteQuery({
    ...conversationsOptions(useAPI(), query),
    placeholderData: keepPreviousData,
  });
}
export function useConversation(id: string) {
  const api = useAPI();
  const detail = useQuery({ ...conversationOptions(api, id), enabled: !!id });
  const list = useInfiniteQuery({ ...messagesOptions(api, id), enabled: !!id });
  return { detail, list };
}
export function useMessageActions() {
  const api = useAPI(),
    cache = useQueryClient(),
    viewer = useViewer();
  const patchMessage =
    (message: Message & { delivery?: "pending" | "sent" }) =>
    (data: unknown, key: import("@tanstack/react-query").QueryKey) => {
      if (
        JSON.stringify(key) ===
        JSON.stringify(messagesOptions(api, message.conversationId).queryKey)
      ) {
        const current = data as
          | { pages: { items: Message[]; nextCursor: string | null }[]; pageParams: unknown[] }
          | undefined;
        if (!current)
          return { pages: [{ items: [message], nextCursor: null }], pageParams: [undefined] };
        const found = current.pages.some((page) =>
          page.items.some((item) => item.clientId === message.clientId),
        );
        return {
          ...current,
          pages: current.pages.map((page, index) => ({
            ...page,
            items: found
              ? page.items.map((item) => (item.clientId === message.clientId ? message : item))
              : index
                ? page.items
                : [message, ...page.items],
          })),
        };
      }
      return mapItems(
        data,
        (item) => item.id === message.conversationId && "participants" in item,
        (item) => ({
          ...item,
          lastMessage: message,
          updatedAt: message.createdAt,
          readReceiptMessageId: null,
        }),
      );
    };
  return {
    start: useMutation(
      accountMutationOptions(
        api.messages.createConversation.mutationOptions({
          onSuccess: (conversation) => {
            seedConversation(cache, api, conversation);
            if (!conversation.lastMessage)
              cache.setQueryData(messagesOptions(api, conversation.id).queryKey, {
                pages: [{ items: [], nextCursor: null }],
                pageParams: [undefined],
              });
            void cache.invalidateQueries({ queryKey: api.messages.conversations.key() });
          },
        }),
      ),
    ),
    send: useMutation({
      ...instantEdit(cache, {
        key: ["message-edits", viewer?.id],
        affects: (key) => viewerPath(key, viewer?.id ?? null, "messages"),
        mutationFn: ({ files, ...input }: MessageAttempt) =>
          api.messages.send.call({ ...input, fileIds: files.map((file) => file.id) }),
        optimistic: (input: MessageAttempt) => {
          const reply = input.replyToMessageId
            ? cache
                .getQueryData(messagesOptions(api, input.conversationId).queryKey)
                ?.pages.flatMap((page) => page.items)
                .find((item) => item.id === input.replyToMessageId)
            : undefined;
          const message: Message & { delivery: "pending" } = {
            id: input.clientId,
            clientId: input.clientId,
            conversationId: input.conversationId,
            senderId: viewer!.id,
            body: input.body ?? "",
            createdAt: new Date().toISOString(),
            delivery: "pending",
            attachment: input.linkId
              ? (cache.getQueryData(
                  api.links.get.queryOptions({ input: { id: input.linkId } }).queryKey,
                ) ?? null)
              : null,
            hasAttachment: !!input.linkId,
            restrictedAuthor: null,
            replyTo: reply
              ? {
                  id: reply.id,
                  senderId: reply.senderId,
                  excerpt: reply.body,
                  hasAttachment: reply.hasAttachment,
                  files: reply.files,
                }
              : null,
            files: [...input.files],
          };
          return patchMessage(message);
        },
        response: (message) => patchMessage(message),
        invalidate: () => window.dispatchEvent(new Event("index:pulse")),
      }),
      meta: { inlineError: true },
    }),
    read: useMutation(
      accountMutationOptions(
        api.messages.markRead.mutationOptions({
          onSuccess: (_, input) => {
            for (const query of cache.getQueryCache().findAll({
              predicate: (query) => viewerPath(query.queryKey, viewer?.id ?? null, "messages"),
            }))
              cache.setQueryData(
                query.queryKey,
                acknowledgeConversation(query.state.data, input.conversationId, input.messageId),
              );
            window.dispatchEvent(new Event("index:pulse"));
          },
        }),
      ),
    ),
  };
}
