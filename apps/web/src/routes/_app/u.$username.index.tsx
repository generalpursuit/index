import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ProfilePage } from "@/features/profiles/profile-page";
import { resolveLocation, preloadProfile, routeHint } from "@/lib/routes";
export const Route = createFileRoute("/_app/u/$username/")({
  validateSearch: z.object({
    settings: z.boolean().optional().catch(undefined),
    group: z.string().optional(),
  }),
  loaderDeps: ({ search }) => ({ group: search.group }),
  loader: async ({ context, location, params }) => {
    const { userId } = routeHint(context, location);
    const own =
      context.session?.user.username === params.username ? context.session.user.id : undefined;
    const early = userId ?? own;
    if (early) void preloadProfile(context, early).catch(() => {});
    const result = await resolveLocation(context, location);
    if (result.kind !== "profile") throw new Error("Destination not found.");
    await preloadProfile(context, result.userId);
    return result;
  },
  component: () => (
    <ProfilePage userId={Route.useLoaderData().userId} settings={Route.useSearch().settings} />
  ),
});
