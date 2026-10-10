import { useEffect } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useViewer } from "@/hooks/use-api";
import { client } from "@/utils/orpc";
import { acceptedDesktopRevision, isDesktop } from "@/lib/desktop";
import { accountGeneration, assertCurrentAccount, onAccountClear } from "@/lib/account-boundary";
import {
  activeConversation,
  clearNotificationAccount,
  desktopInvoke,
  deviceStatus,
} from "./device";
import { notificationPath } from "./navigation";
export function NotificationLifecycle() {
  const viewer = useViewer(),
    router = useRouter();
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => onAccountClear(clearNotificationAccount), []);
  useEffect(() => {
    if (!viewer) return;
    void deviceStatus(viewer.id).catch(() => {});
  }, [viewer?.id]);
  useEffect(() => {
    if (!viewer) return;
    let disposed = false;
    const generation = accountGeneration();
    const cleanupRevision = acceptedDesktopRevision();
    async function update() {
      const expectedRevision = acceptedDesktopRevision();
      try {
        let id: string | null = null;
        if (
          document.visibilityState === "visible" &&
          document.hasFocus() &&
          path.startsWith("/messages/")
        ) {
          const route = await client.routes.resolve({ path });
          if (route.kind === "conversation") id = route.conversationId;
        }
        assertCurrentAccount(generation);
        if (disposed) return;
        await activeConversation(id, expectedRevision);
        if (isDesktop) {
          const click = await desktopInvoke<{
            id: string;
            path: string;
            recipientId: string;
          } | null>("notification_take_click", undefined, expectedRevision);
          assertCurrentAccount(generation);
          const destination = notificationPath(click, viewer!.id);
          if (destination && !disposed) {
            const route = await client.routes.resolve({ path: destination });
            assertCurrentAccount(generation);
            if (!disposed) {
              await router.navigate({ href: route.canonicalPath });
              await desktopInvoke("notification_take_click", { ack: click!.id }, expectedRevision);
            }
          }
        }
      } catch {
        /* No private fallback for unavailable/unauthorized destinations. */
      }
    }
    void update();
    const interval = setInterval(() => void update(), 15_000);
    const refresh = () => void update();
    window.addEventListener("focus", refresh);
    window.addEventListener("blur", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("blur", refresh);
      document.removeEventListener("visibilitychange", refresh);
      void activeConversation(null, cleanupRevision).catch(() => {});
    };
  }, [viewer?.id, path, router]);
  return null;
}
