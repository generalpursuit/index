import { useTheme } from "@/lib/appearance/use-theme";
import { NotificationLifecycle } from "@/features/notifications/lifecycle";
import { isMenuBar } from "@/lib/desktop";
import { DesktopTheme } from "@/lib/desktop/theme";
import { Button } from "@index/ui/components/button";
import { Toaster } from "@index/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { HeadContent, Outlet, createRootRouteWithContext, Link } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
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

function Root() {
  const { resolved } = useTheme();
  return (
    <>
      <HeadContent />
      <DesktopTheme />
      {!isMenuBar && <NotificationLifecycle />}
      <Outlet />
      <Toaster
        theme={resolved}
        richColors
        offset={isMenuBar ? 56 : undefined}
        mobileOffset={isMenuBar ? { bottom: 56, left: 12, right: 12 } : undefined}
      />
    </>
  );
}
