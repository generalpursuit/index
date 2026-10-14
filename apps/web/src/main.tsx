import { canPrefetch } from "./data/client";
import { restoreAccount } from "./data/account";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import { clearAccountState, onAccountClear } from "./lib/account-boundary";
import { resetSession } from "./lib/session";
import { installDesktopSync } from "./lib/desktop/sync";
import { installDesktopLinks } from "./lib/desktop";
import { toast } from "sonner";

import { AppShell } from "./components/app/shell";
import { UpdateRequired } from "./components/app/update-required";
import { routeTree } from "./routeTree.gen";
import { orpc, queryClient } from "./utils/orpc";

const router = createRouter({
  routeTree,
  defaultPreload: canPrefetch() ? "intent" : false,
  defaultPreloadStaleTime: 0,
  defaultPendingMs: 300,
  defaultPendingMinMs: 400,
  scrollToTopSelectors: ["#app-scroll"],
  scrollRestoration: true,
  defaultPendingComponent: () => <AppShell pending />,
  context: { orpc, queryClient },
  Wrap: function WrapComponent({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  },
});

onAccountClear(() => router.clearCache());

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
  interface StaticDataRouteOption {
    /** Full-height pages that scroll inside themselves. */
    layout?: "feed" | "chat";
  }
  /** Identifiers a link already knows, so the next page loads while its path is checked. */
  interface HistoryState {
    userId?: string;
    groupId?: string;
    conversationId?: string;
  }
}

installDesktopLinks((message) => toast.error(message));
window.addEventListener("index:desktop-signed-out", () => {
  void clearAccountState(queryClient);
  toast.dismiss();
  void router.navigate({ to: "/login", replace: true }).then(() => router.invalidate());
});
window.addEventListener("index:session-expired", () => {
  void clearAccountState(queryClient);
  void router.invalidate();
});

window.addEventListener("index:verification-required", () => {
  void resetSession()
    .catch(() => {})
    .finally(() => router.invalidate());
});

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element not found");
}

async function mount() {
  // Private mode and storage failures still permit an ordinary network-only start.
  await restoreAccount().catch(() => {});
  const dispose = await installDesktopSync(
    queryClient,
    () => router.invalidate(),
    (href) => router.navigate({ href }),
  );
  if (import.meta.hot) import.meta.hot.dispose(dispose);
  if (!rootElement!.innerHTML) {
    // Outside the router, so a failed route cannot hide that this release must update.
    ReactDOM.createRoot(rootElement!).render(
      <>
        <RouterProvider router={router} />
        <UpdateRequired />
      </>,
    );
  }
}
void mount().catch(() => {
  rootElement.textContent =
    "Could not connect to Index’s desktop session. Close and reopen this window to try again.";
});
