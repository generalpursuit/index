import { useEffect, useRef } from "react";
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
  const applied = useRef({ account: viewer?.id, versions: new Map<string, string>() });
  if (applied.current.account !== viewer?.id)
    applied.current = { account: viewer?.id, versions: new Map() };
  const path = useRouterState({ select: (state) => state.location.pathname });
  const conversationId = useRouterState({
    select: (state) =>
      (state.matches.at(-1)?.loaderData as { conversationId?: string } | undefined)?.conversationId,
  });
  useEffect(() => {
    if (!viewer || isMenuBar) return;
    const generation = accountGeneration();
    const newestPage = <T,>(
      key: import("@tanstack/react-query").QueryKey,
      load: (signal: AbortSignal) => Promise<T>,
    ) =>
      cache.fetchQuery({
        queryKey: [...key, "pulse"],
        queryFn: ({ signal }) => load(signal),
        staleTime: 0,
        gcTime: 0,
      });
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
      changed: async (pulse: Pulse) => {
        const needs = (key: import("@tanstack/react-query").QueryKey, version: string) =>
          applied.current.versions.get(JSON.stringify(key)) !== version;
        const remember = (key: import("@tanstack/react-query").QueryKey, version: string) =>
          applied.current.versions.set(JSON.stringify(key), version);
        assertCurrentAccount(generation);
        cache.setQueryData(pulseKey(viewer.id), pulse);
        const jobs: Promise<unknown>[] = [];
        {
          for (const query of cache.getQueryCache().findAll({
            predicate: (query) =>
              viewerPath(query.queryKey, viewer.id, "messages") &&
              (query.queryKey[0] as string[])[3] === "conversations" &&
              query.getObserversCount() > 0,
          })) {
            if (!needs(query.queryKey, pulse.messages.version)) continue;
            const input = (query.queryKey[1] as { input?: { query?: string } }).input;
            const options = conversationsOptions(api, input?.query);
            jobs.push(
              newestPage(options.queryKey, (signal) =>
                api.messages.conversations.call({ limit: 30, query: input?.query }, { signal }),
              ).then((page) => {
                assertCurrentAccount(generation);
                cache.setQueryData(options.queryKey, (current) => mergeNewestPage(current, page));
                remember(options.queryKey, pulse.messages.version);
              }),
            );
          }
          if (conversationId) {
            const options = messagesOptions(api, conversationId);
            if (needs(options.queryKey, pulse.messages.version))
              jobs.push(
                newestPage(options.queryKey, (signal) =>
                  api.messages.list.call({ conversationId, limit: 30 }, { signal }),
                ).then((page) => {
                  assertCurrentAccount(generation);
                  cache.setQueryData(options.queryKey, (current) => mergeNewestPage(current, page));
                  remember(options.queryKey, pulse.messages.version);
                }),
              );
            const detail = conversationOptions(api, conversationId);
            if (needs(detail.queryKey, pulse.messages.version))
              jobs.push(
                cache.fetchQuery({ ...detail, staleTime: 0 }).then(() => {
                  assertCurrentAccount(generation);
                  remember(detail.queryKey, pulse.messages.version);
                }),
              );
          }
        }
        {
          for (const query of cache.getQueryCache().findAll({
            predicate: (query) =>
              viewerPath(query.queryKey, viewer.id, "activity") && query.getObserversCount() > 0,
          })) {
            if (!needs(query.queryKey, pulse.activity.version)) continue;
            const options = query.options as { queryKey: typeof query.queryKey };
            const input = (
              options.queryKey[1] as
                | { input?: { type?: "comment" | "request" | "mention" | "follow" } }
                | undefined
            )?.input;
            jobs.push(
              newestPage(options.queryKey, (signal) =>
                api.activity.list.call({ type: input?.type, limit: 30 }, { signal }),
              ).then((page) => {
                assertCurrentAccount(generation);
                cache.setQueryData(activityOptions(api, input?.type).queryKey, (current) =>
                  mergeNewestPage(current, page),
                );
                remember(query.queryKey, pulse.activity.version);
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
  }, [viewer?.id, conversationId, path, cache, api]);
  return null;
}
