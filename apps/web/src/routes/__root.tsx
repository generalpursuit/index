import { Button } from "@index/ui/components/button";
import { Toaster } from "@index/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { HeadContent, Outlet, createRootRouteWithContext, Link } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import "../index.css";
export interface RouterAppContext {
  orpc: typeof orpc;
  queryClient: QueryClient;
}
export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: () => (
    <>
      <HeadContent />
      <Outlet />
      <Toaster theme="dark" richColors />
    </>
  ),
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
    <div className="route-error">
      <h1>Page not found</h1>
      <Link to="/">Back home</Link>
    </div>
  ),
  errorComponent: ({ error, reset }) => (
    <div className="route-error" role="alert">
      <h1>Couldn’t open this page</h1>
      <p>{error instanceof Error ? error.message : "Please try again."}</p>
      <Button onClick={reset}>Try again</Button>
      <Link to="/">Back home</Link>
    </div>
  ),
});
