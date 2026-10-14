import { pulseKey } from "@/data/pulse-lifecycle";
import type { Pulse } from "@/data/pulse";
import { accountMutationOptions } from "@/lib/account-boundary";
import { activityOptions } from "../queries";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAPI, useViewer } from "@/hooks/use-api";
export function useActivity(type?: "comment" | "request" | "mention" | "follow") {
  const api = useAPI(),
    cache = useQueryClient();
  const list = useInfiniteQuery(activityOptions(api, type));
  const read = useMutation(
    accountMutationOptions(
      api.activity.markRead.mutationOptions({
        onSuccess: (_, input) => {
          cache.setQueriesData(
            { queryKey: api.activity.list.key() },
            (current: typeof list.data) =>
              current && {
                ...current,
                pages: current.pages.map((page) => ({
                  ...page,
                  items: page.items.map((item) =>
                    input.ids.includes(item.id)
                      ? { ...item, readAt: new Date().toISOString() }
                      : item,
                  ),
                })),
              },
          );
          window.dispatchEvent(new Event("index:pulse"));
        },
      }),
    ),
  );
  return { list, read };
}
export function useUnread() {
  const viewer = useViewer();
  const pulse = useQuery<Pulse>({ queryKey: pulseKey(viewer?.id ?? "anonymous"), enabled: false });
  return {
    activity: pulse.data?.activity.unreadCount ?? 0,
    messages: pulse.data?.messages.unreadCount ?? 0,
  };
}
