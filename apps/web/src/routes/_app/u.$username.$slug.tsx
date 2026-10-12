import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ProfilePage } from "@/features/profiles/profile-page";
import { resolveLocation, preloadProfile, routeHint } from "@/lib/routes";
export const Route = createFileRoute("/_app/u/$username/$slug")({
  validateSearch: z.object({ settings: z.boolean().optional().catch(undefined) }),
  loader: async ({ context, location }) => {
    const hint = routeHint(context, location);
    if (hint.userId && hint.groupId)
      void preloadProfile(context, hint.userId, hint.groupId).catch(() => {});
    const result = await resolveLocation(context, location);
    if (result.kind !== "group") throw new Error("Destination not found.");
    await preloadProfile(context, result.userId, result.groupId);
    return result;
  },
  component: () => (
    <ProfilePage
      userId={Route.useLoaderData().userId}
      group={Route.useLoaderData().groupId}
      settings={Route.useSearch().settings}
    />
  ),
});
