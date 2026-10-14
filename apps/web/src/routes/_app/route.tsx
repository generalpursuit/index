import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app/shell";
import { sessionOptions } from "@/lib/session";
import { appSearch } from "@/lib/search";
export const Route = createFileRoute("/_app")({
  pendingMs: 0,
  pendingMinMs: 0,
  validateSearch: appSearch,
  beforeLoad: ({ context, location }) => {
    const accept = (session: import("@/data/account").AccountSession | null) => {
      if (session && !session.user.emailVerified)
        throw redirect({ to: "/login", search: { next: location.href } });
      return { session };
    };
    const session = context.queryClient.getQueryData(sessionOptions.queryKey);
    if (session !== undefined) {
      void context.queryClient.prefetchQuery(sessionOptions);
      return accept(session);
    }
    return context.queryClient.ensureQueryData(sessionOptions).then(accept);
  },
  pendingComponent: () => <AppShell pending />,
  component: AppShell,
});
