import { flushSync } from "react-dom";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { accountGeneration, assertCurrentAccount, clearAccountState } from "../account-boundary";
import { sessionOptions } from "../session";
import { client } from "@/utils/orpc";
import { acceptedDesktopRevision, desktopInvoke, isDesktop, isMenuBar } from "./index";
import { contentFeatures } from "@/data/content";
import { isMessageFileQuery } from "@/features/messages/queries";

type RevisionEvent = { revision: number; source: string | null };
/** The host shows the panel at once when it already holds content for the current account. */
type MenuOpened = { presented: boolean };
type PendingNavigation = { id: number; path: string; recipientId: string | null };

let menuPanelHeight: (() => number) | undefined;
/** The menu page measures its content so the native panel opens at the matching height. */
export function measureMenuPanel(measure: () => number) {
  menuPanelHeight = measure;
  return () => {
    if (menuPanelHeight === measure) menuPanelHeight = undefined;
  };
}

export async function presentMenuPanel(safeError = false) {
  if (!isMenuBar) return;
  // Bind visibility to the session response that actually produced the rendered UI.
  // Reading a newer revision here could bless old cached content before its event arrives.
  const expectedRevision = safeError
    ? await desktopInvoke<number>("session_revision")
    : acceptedDesktopRevision();
  if (expectedRevision !== undefined && expectedRevision >= 0)
    await desktopInvoke("desktop_panel_ready", { expectedRevision, height: menuPanelHeight?.() });
}

export async function openIndex(path?: string, recipientId?: string) {
  const generation = accountGeneration();
  const expectedRevision = acceptedDesktopRevision();
  assertCurrentAccount(generation);
  if (expectedRevision === undefined)
    throw new DOMException("Check your session first", "AbortError");
  await desktopInvoke("desktop_open", { path, recipientId, expectedRevision });
}

/** Install once before mounting either router. Events never carry credentials or cache data. */
export async function installDesktopSync(
  cache: QueryClient,
  invalidateRouter: () => Promise<unknown>,
  navigate: (path: string) => Promise<unknown>,
) {
  if (!isDesktop) return () => {};
  const label = await desktopInvoke<string>("desktop_window");
  let revision = -1,
    disposed = false,
    refreshing: Promise<void> | undefined;
  let refreshAgain = false,
    navigating = false;
  const cleanups: (() => void)[] = [];

  async function pendingNavigation() {
    if (disposed || isMenuBar || navigating) return;
    navigating = true;
    try {
      const generation = accountGeneration();
      const expectedRevision = await desktopInvoke<number>("session_revision");
      const pending = await desktopInvoke<PendingNavigation | null>("desktop_take_navigation", {
        expectedRevision,
      });
      assertCurrentAccount(generation);
      if (!pending) return;
      const session = await cache.fetchQuery({ ...sessionOptions, staleTime: 0 });
      assertCurrentAccount(generation);
      if (pending.recipientId) {
        // Keep the opaque route while signed out/restricted. The same verified
        // recipient can resume; a different account never navigates to it.
        if (!session?.user.emailVerified) return;
        if (session.user.id !== pending.recipientId) {
          await desktopInvoke("desktop_take_navigation", { ack: pending.id, expectedRevision });
          return;
        }
      }
      const path = pending.path.startsWith("/l/")
        ? (await client.routes.resolve({ path: pending.path })).canonicalPath
        : pending.path;
      assertCurrentAccount(generation);
      if (expectedRevision !== (await desktopInvoke<number>("session_revision"))) return;
      await navigate(path);
      assertCurrentAccount(generation);
      await desktopInvoke("desktop_take_navigation", { ack: pending.id, expectedRevision });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      toast.error("Could not open this Index destination. Try again from the menu bar.");
    } finally {
      navigating = false;
    }
  }
  function refresh() {
    if (refreshing) {
      refreshAgain = true;
      return refreshing;
    }
    refreshing = (async () => {
      do {
        refreshAgain = false;
        try {
          await cache.fetchQuery({ ...sessionOptions, staleTime: 0 });
          if (isMenuBar) {
            await invalidateRouter();
            // File bytes never change, so photos on screen aren't downloaded again.
            await cache.invalidateQueries({
              predicate: (q) => q.queryKey[0] !== "session" && !isMessageFileQuery(q.queryKey),
            });
          }
          await pendingNavigation();
        } catch {
          /* No fallback identity when offline; panel offers Retry. */
        }
      } while (refreshAgain && !disposed);
    })().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  }
  function acceptSession(event: RevisionEvent) {
    if (disposed || event.revision <= revision) return;
    revision = event.revision;
    if (event.source === label) return;
    // Clear before any asynchronous revalidation, including drafts and late callbacks.
    void clearAccountState(cache);
    toast.dismiss();
    void refresh().finally(() => {
      void presentMenuPanel().catch(() => {});
    });
  }
  /** A shown panel revalidates in place; any other opening of the panel shows after this check. */
  async function focus(presented = false) {
    const checking = isMenuBar && !presented;
    if (checking) window.dispatchEvent(new Event("index:menu-checking"));
    try {
      const next = await desktopInvoke<number>("session_revision");
      if (next > revision) acceptSession({ revision: next, source: null });
      if (isMenuBar || acceptedDesktopRevision() !== next) await refresh();
      else {
        void cache.prefetchQuery(sessionOptions);
        window.dispatchEvent(new Event("index:pulse"));
        await pendingNavigation();
      }
    } catch {
      void clearAccountState(cache);
    } finally {
      if (checking) flushSync(() => window.dispatchEvent(new Event("index:menu-checked")));
      if (isMenuBar) void presentMenuPanel().catch(() => {});
    }
  }
  const local = (event: Event) => {
    revision = Math.max(revision, (event as CustomEvent<number>).detail);
  };
  window.addEventListener("index:desktop-local-session", local);
  cleanups.push(() => window.removeEventListener("index:desktop-local-session", local));
  const listen = window.__TAURI__!.event.listen;
  try {
    cleanups.push(
      await listen<RevisionEvent>("index:desktop-session", ({ payload }) => acceptSession(payload)),
    );
    cleanups.push(
      await listen<RevisionEvent>("index:desktop-data", ({ payload }) => {
        if (disposed || payload.source === label || payload.revision !== revision) return;
        window.dispatchEvent(new Event("index:pulse"));
        void cache.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey[0]) &&
            contentFeatures.has(query.queryKey[0][2]) &&
            !["messages", "activity", "routes"].includes(query.queryKey[0][2]),
        });
      }),
    );
    // Each window hears only of its own opening, so opening the panel leaves main alone.
    cleanups.push(
      await (isMenuBar
        ? listen<MenuOpened>("index:menu-open", ({ payload }) => void focus(payload.presented))
        : listen("index:desktop-open", () => void focus())),
    );
    if (isMenuBar)
      cleanups.push(
        await listen("index:menu-closed", () =>
          window.dispatchEvent(new Event("index:menu-closed")),
        ),
      );
    const initial = await desktopInvoke<number>("session_revision");
    if (acceptedDesktopRevision() !== undefined && acceptedDesktopRevision() !== initial)
      acceptSession({ revision: initial, source: null });
    else revision = Math.max(revision, initial);
  } catch (error) {
    cleanups.forEach((cleanup) => cleanup());
    throw error;
  }
  const stale = () => {
    void clearAccountState(cache);
    toast.dismiss();
    void focus();
  };
  window.addEventListener("index:desktop-stale-window", stale);
  cleanups.push(() => window.removeEventListener("index:desktop-stale-window", stale));
  // The panel revalidates on every opening and hides on blur, so its focus always follows that
  // opening; checking again would replace its visible content with the status.
  if (!isMenuBar) {
    const focused = () => void focus();
    window.addEventListener("focus", focused);
    cleanups.push(() => window.removeEventListener("focus", focused));
  }
  cleanups.push(
    cache.getMutationCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      const expectedRevision = revision;
      void desktopInvoke("desktop_changed", { expectedRevision }).catch(() => {});
    }),
  );
  cleanups.push(
    cache.getQueryCache().subscribe((event) => {
      if (
        event.type === "updated" &&
        event.action.type === "success" &&
        event.query.queryKey[0] === "session"
      ) {
        void pendingNavigation();
      }
    }),
  );
  // Cold main-window recreation must resume a queued destination without a focus event.
  if (!isMenuBar) void pendingNavigation();
  return () => {
    disposed = true;
    cleanups.forEach((cleanup) => cleanup());
  };
}
