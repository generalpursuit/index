import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAPI, useViewer } from "@/hooks/use-api";
import { accountGeneration, assertCurrentAccount } from "@/lib/account-boundary";
import { isMenuBar } from "@/lib/desktop";
import { viewerPath } from "./edits";
import { createPulseDriver, mergeNewestPage, type Pulse } from "./pulse";
import {
  conversationsOptions,
  conversationOptions,
  messagesOptions,
} from "@/features/messages/queries";
import { activityOptions } from "@/features/activity/queries";

export const pulseKey = (account: string) => ["pulse", account];
export function PulseLifecycle() {
  const viewer = useViewer(),
    api = useAPI(),
    cache = useQueryClient();
  const conversationId = useRouterState({
    select: (state) =>
      (state.matches.at(-1)?.loaderData as { conversationId?: string } | undefined)?.conversationId,
  });
  useEffect(() => {
    if (!viewer || isMenuBar) return;
    const generation = accountGeneration();
    let legacy = false,
      legacyVersion = 0;
    const driver = createPulseDriver({
      visible: () => !document.hidden,
      focusedConversation: () => !!conversationId && document.hasFocus(),
      request: async () => {
        try {
          if (!legacy) {
            const pulse = await api.pulse.get.call();
            assertCurrentAccount(generation);
            return pulse;
          }
        } catch (error) {
          if (!(error && typeof error === "object" && "status" in error && error.status === 404))
            throw error;
          legacy = true;
        }
        const [messages, activity] = await Promise.all([
          api.messages.unread.call(),
          api.activity.list.call({ limit: 1 }),
        ]);
        assertCurrentAccount(generation);
        const version = String(++legacyVersion);
        return {
          messages: { ...messages, version },
          activity: { unreadCount: activity.unreadCount, version },
        };
      },
      changed: async (pulse: Pulse, messagesChanged, activityChanged) => {
        assertCurrentAccount(generation);
        cache.setQueryData(pulseKey(viewer.id), pulse);
        const jobs: Promise<unknown>[] = [];
        if (messagesChanged) {
          const options = conversationsOptions(api);
          if (
            cache
              .getQueryCache()
              .find({ queryKey: options.queryKey, exact: true })
              ?.getObserversCount()
          )
            jobs.push(
              api.messages.conversations.call({ limit: 30 }).then((page) => {
                assertCurrentAccount(generation);
                cache.setQueryData(options.queryKey, (current) => mergeNewestPage(current, page));
              }),
            );
          if (conversationId) {
            const options = messagesOptions(api, conversationId);
            jobs.push(
              api.messages.list.call({ conversationId, limit: 30 }).then((page) => {
                assertCurrentAccount(generation);
                cache.setQueryData(options.queryKey, (current) => mergeNewestPage(current, page));
              }),
            );
            jobs.push(
              cache.fetchQuery({ ...conversationOptions(api, conversationId), staleTime: 0 }),
            );
          }
        }
        if (activityChanged) {
          for (const query of cache.getQueryCache().findAll({
            predicate: (query) =>
              viewerPath(query.queryKey, viewer.id, "activity") && query.getObserversCount() > 0,
          })) {
            const options = query.options as { queryKey: typeof query.queryKey };
            const input = (
              options.queryKey[1] as
                | { input?: { type?: "comment" | "request" | "mention" | "follow" } }
                | undefined
            )?.input;
            jobs.push(
              api.activity.list.call({ type: input?.type, limit: 30 }).then((page) => {
                assertCurrentAccount(generation);
                cache.setQueryData(activityOptions(api, input?.type).queryKey, (current) =>
                  mergeNewestPage(current, page),
                );
              }),
            );
          }
        }
        await Promise.all(jobs);
      },
    });
    void driver.tick();
    const refresh = () => void driver.tick();
    window.addEventListener("focus", refresh);
    window.addEventListener("index:pulse", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      driver.stop();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("index:pulse", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [viewer?.id, conversationId, cache, api]);
  return null;
}
