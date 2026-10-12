import { identifyClient } from "../client-version";
import { createSessionEventFetch } from "../session-events";
import { ENV } from "@/env.public";
import { createNativeSessionFetch, type NativeSessionSnapshot } from "./session-fetch";

export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const isMenuBar = isDesktop && window.__INDEX_MENU_BAR__ === true;
declare global {
  interface Window {
    __INDEX_MENU_BAR__?: boolean;
    __TAURI__?: {
      event: {
        listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void>;
      };
      core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
    };
  }
}
export async function desktopInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!window.__TAURI__) throw new Error("The desktop bridge is unavailable.");
  return window.__TAURI__.core.invoke<T>(command, args);
}
let checkedRevision = -1;
export const checkedSessionRevision = () => checkedRevision;
const nativeSessionFetch = isDesktop
  ? createNativeSessionFetch(
      ENV.VITE_SERVER_URL,
      {
        read: () => desktopInvoke<NativeSessionSnapshot>("session_snapshot"),
        revision: () => desktopInvoke<number>("session_revision"),
        write: async (token, expectedRevision) => {
          const revision = await desktopInvoke<number>("session_compare_write", {
            token,
            expectedRevision,
          });
          window.dispatchEvent(
            new CustomEvent("index:desktop-local-session", { detail: revision }),
          );
          return revision;
        },
        touch: async (expectedRevision) => {
          const revision = await desktopInvoke<number>("session_touch", { expectedRevision });
          window.dispatchEvent(
            new CustomEvent("index:desktop-local-session", { detail: revision }),
          );
          return revision;
        },
      },
      fetch,
      () => window.dispatchEvent(new Event("index:session-expired")),
      (revision) => {
        checkedRevision = revision;
      },
      () => window.dispatchEvent(new Event("index:desktop-stale-window")),
      () => window.dispatchEvent(new Event("index:desktop-signed-out")),
    )
  : null;
const sessionFetch: typeof fetch =
  nativeSessionFetch ?? ((input, init) => fetch(input, { ...init, credentials: "include" }));

export function acceptedDesktopRevision() {
  return nativeSessionFetch?.acceptedRevision();
}
export async function revokeDesktopAccess() {
  if (!nativeSessionFetch) return;
  const revision = await desktopInvoke<number>("session_touch", {
    expectedRevision: checkedRevision,
    invalidateNotifications: true,
  });
  checkedRevision = revision;
  window.dispatchEvent(new CustomEvent("index:desktop-local-session", { detail: revision }));
}
export function acceptDesktopSession(revision = checkedRevision) {
  nativeSessionFetch?.acceptSession(revision);
}

/** Restricted sessions retain their native credential, but must drop all app content. */
export const apiFetch = createSessionEventFetch(
  identifyClient(sessionFetch, isDesktop ? "desktop" : "web"),
  (event) => {
    if (isDesktop && event === "index:verification-required") {
      void revokeDesktopAccess()
        .then(() => window.dispatchEvent(new Event(event)))
        .catch(() => {
          window.dispatchEvent(new Event("index:desktop-stale-window"));
        });
    } else window.dispatchEvent(new Event(event));
  },
);

export function installDesktopLinks(reportError: (message: string) => void) {
  if (!isDesktop) return () => {};
  document.documentElement.dataset.desktop = "true";
  const handler = (event: MouseEvent) => {
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const url = new URL(anchor.href);
    if (!["https:", "http:"].includes(url.protocol) || url.origin === location.origin) return;
    event.preventDefault();
    event.stopPropagation();
    void desktopInvoke<void>("open_website", { url: url.href }).catch(() =>
      reportError("Could not open this link in your browser."),
    );
  };
  document.addEventListener("click", handler, true);
  document.addEventListener("auxclick", handler, true);
  return () => {
    document.removeEventListener("click", handler, true);
    document.removeEventListener("auxclick", handler, true);
  };
}
