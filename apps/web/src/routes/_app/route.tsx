import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app/shell";
import { sessionOptions } from "@/lib/session";
import { appSearch } from "@/lib/search";
export const Route = createFileRoute("/_app")({
  validateSearch: appSearch,
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionOptions);
    if (session && !session.user.emailVerified)
      throw redirect({ to: "/login", search: { next: location.href } });
    return { session };
  },
  component: AppShell,
});
