import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import { clearAccountState } from "./lib/account-boundary";
import { resetSession } from "./lib/session";
import { installDesktopSync } from "./lib/desktop/sync";
import { installDesktopLinks } from "./lib/desktop";
import { toast } from "sonner";

import Loader from "./components/loader";
import { UpdateRequired } from "./components/app/update-required";
import { routeTree } from "./routeTree.gen";
import { orpc, queryClient } from "./utils/orpc";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  // The current page stays, under a progress bar, until the next one is ready. Only a very slow
  // load replaces it with a spinner.
  defaultPendingMs: 3000,
  scrollToTopSelectors: ["#app-scroll"],
  scrollRestoration: true,
  defaultPendingComponent: () => <Loader />,
  context: { orpc, queryClient },
  Wrap: function WrapComponent({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  },
});

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
