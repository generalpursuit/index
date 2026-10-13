import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app/shell";
import { sessionOptions } from "@/lib/session";
import { appSearch } from "@/lib/search";
import { loadLinkReference } from "@/features/routes/link-reference";
import { apiFor } from "@/utils/orpc";
export const Route = createFileRoute("/_app")({
  validateSearch: appSearch,
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionOptions);
    if (session && !session.user.emailVerified)
      throw redirect({ to: "/login", search: { next: location.href } });
    return { session };
  },
  // A post or editor in the address opens complete, like a page, loaded alongside the page.
  loaderDeps: ({ search }) => ({ post: search.post, edit: search.edit }),
  loader: async ({ context, deps }) => {
    const api = apiFor(context.session?.user.id ?? null);
    await Promise.all([
      deps.post && loadLinkReference(context.queryClient, api, deps.post, "post"),
      deps.edit && loadLinkReference(context.queryClient, api, deps.edit, "edit"),
    ]);
  },
  component: AppShell,
});
