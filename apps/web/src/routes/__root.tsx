import { useTheme } from "@/lib/appearance/use-theme";
import { NotificationLifecycle } from "@/features/notifications/lifecycle";
import { isMenuBar } from "@/lib/desktop";
import { DesktopTheme } from "@/lib/desktop/theme";
import { Button } from "@index/ui/components/button";
import { Toaster } from "@index/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
  Link,
  useRouterState,
} from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import { useEffect, useState } from "react";
import "../index.css";

// Shared by instances in this component; markers remain available to scroll hooks/tests.
const routeErrorClassName =
  "route-error select-none bg-background text-foreground text-[14px] leading-[1.5] min-h-dvh flex gap-6 items-center justify-center flex-col p-7.5 [&_p]:select-text [&_h1]:font-semibold [&_h1]:tracking-[-0.035em] [&_h1]:leading-[1.1] [&_h1]:text-[40px] [&_a]:underline";

export interface RouterAppContext {
  orpc: typeof orpc;
  queryClient: QueryClient;
}
export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: Root,
  head: () => ({
    meta: [
      { title: "Index" },
      {
        name: "description",
        content:
          "Save what matters. Discover what your friends are reading, watching, and listening to.",
      },
    ],
  }),
  notFoundComponent: () => (
    <div className={routeErrorClassName}>
      <h1>Page not found</h1>
      <Link to="/">Back home</Link>
    </div>
  ),
  errorComponent: ({ error, reset }) => (
    <div className={routeErrorClassName} role="alert">
      <h1>Couldn’t open this page</h1>
      <p>{error instanceof Error ? error.message : "Please try again."}</p>
      <Button onClick={reset}>Try again</Button>
      <Link to="/">Back home</Link>
    </div>
  ),
});

/** Shown while a page loads behind the current one; quick loads finish before it appears. */
function NavigationProgress() {
  const loading = useRouterState({ select: (s) => s.status === "pending" });
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setSlow(true), 150);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [loading]);
  return loading && slow ? (
    <div
      aria-hidden="true"
      className="navigation-progress fixed inset-x-0 top-[var(--titlebar-inset)] z-100 h-0.5 origin-left bg-foreground/50 [animation:navigation-progress_8s_cubic-bezier(0.1,0.7,0.2,1)_both]"
    />
  ) : null;
}

function Root() {
  const { resolved } = useTheme();
  return (
    <>
      <NavigationProgress />
      <HeadContent />
      <DesktopTheme />
      {!isMenuBar && <NotificationLifecycle />}
      <Outlet />
      <Toaster
        theme={resolved}
        // Above the menu panel's footer.
        offset={isMenuBar ? 80 : undefined}
        mobileOffset={isMenuBar ? { bottom: 80, left: 12, right: 12 } : undefined}
      />
    </>
  );
}
