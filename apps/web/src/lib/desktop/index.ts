import { createSessionEventFetch } from "../session-events";
import { ENV } from "@/env.public";
import { createNativeSessionFetch } from "./session-fetch";

export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
declare global {
  interface Window {
    __TAURI__?: {
      core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
    };
  }
}
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!window.__TAURI__) throw new Error("The desktop bridge is unavailable.");
  return window.__TAURI__.core.invoke<T>(command, args);
}
const sessionFetch: typeof fetch = isDesktop
  ? createNativeSessionFetch(
      ENV.VITE_SERVER_URL,
      {
        read: () => invoke<string | null>("session_read"),
        write: (token) => invoke<void>("session_write", { token }),
      },
      fetch,
      () => window.dispatchEvent(new Event("index:session-expired")),
    )
  : (input, init) => fetch(input, { ...init, credentials: "include" });

/** Restricted sessions retain their native credential, but must drop all app content. */
export const apiFetch = createSessionEventFetch(sessionFetch, (event) => {
  window.dispatchEvent(new Event(event));
});

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
    void invoke<void>("open_website", { url: url.href }).catch(() =>
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
