import { createFileRoute } from "@tanstack/react-router";
import { LinkDetail } from "@/features/links/link-detail";
import { linkOptions, commentsOptions } from "@/features/links/queries";
import { groupOptions } from "@/features/groups/queries";
import { apiFor } from "@/utils/orpc";
import { resolveLocation } from "@/lib/routes";
export const Route = createFileRoute("/_app/l/$shortId")({
  loader: async ({ context, location }) => {
    const result = await resolveLocation(context, location);
    if (result.kind !== "link") throw new Error("Destination not found.");
    const api = apiFor(context.session?.user.id ?? null);
    await Promise.all([
      // The group names the post's label row; the post still opens if it can't be read.
      context.queryClient.ensureQueryData(linkOptions(api, result.linkId)).then((link) => {
        if (link.groupId) return context.queryClient.prefetchQuery(groupOptions(api, link.groupId));
      }),
      context.queryClient.ensureInfiniteQueryData(commentsOptions(api, result.linkId)),
    ]);
    return result;
  },
  component: () => <LinkDetail id={Route.useLoaderData().linkId} standalone />,
});
