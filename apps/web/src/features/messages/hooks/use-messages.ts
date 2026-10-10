import { accountMutationOptions } from "@/lib/account-boundary";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
import { conversationsOptions, conversationOptions, messagesOptions } from "../queries";
export function useConversations(query?: string) {
  return useInfiniteQuery(conversationsOptions(useAPI(), query));
}
export function useConversation(id: string) {
  const api = useAPI();
  const detail = useQuery(conversationOptions(api, id));
  const list = useInfiniteQuery(messagesOptions(api, id));
  return { detail, list };
}
export function useMessageActions() {
  const api = useAPI(),
    cache = useQueryClient();
  const refresh = () => cache.invalidateQueries({ queryKey: api.messages.key() });
  return {
    start: useMutation(
      accountMutationOptions(
        api.messages.createConversation.mutationOptions({ onSuccess: refresh }),
      ),
    ),
    send: useMutation(
      accountMutationOptions(
        api.messages.send.mutationOptions({
          onMutate: (input) =>
            cache.cancelQueries({
              queryKey: messagesOptions(api, input.conversationId).queryKey,
              exact: true,
            }),
          onSuccess: (message, input) => {
            cache.setQueryData(
              messagesOptions(api, input.conversationId).queryKey,
              (current) =>
                current && {
                  ...current,
                  pages: current.pages.map((page, index) => ({
                    ...page,
                    items: current.pages.some((p) => p.items.some((item) => item.id === message.id))
                      ? page.items.map((item) => (item.id === message.id ? message : item))
                      : index === 0
                        ? [message, ...page.items]
                        : page.items,
                  })),
                },
            );
            void cache.invalidateQueries({ queryKey: api.messages.conversations.key() });
            void cache.invalidateQueries({ queryKey: api.messages.conversation.key() });
          },
        }),
      ),
    ),
    read: useMutation(
      accountMutationOptions(
        api.messages.markRead.mutationOptions({
          onSuccess: () => {
            void cache.invalidateQueries({ queryKey: api.messages.unread.key() });
            void cache.invalidateQueries({ queryKey: api.messages.conversations.key() });
          },
        }),
      ),
    ),
  };
}
