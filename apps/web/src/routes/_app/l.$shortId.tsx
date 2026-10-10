import { createFileRoute } from "@tanstack/react-router";
import { LinkDetail } from "@/features/links/link-detail";
import { linkOptions, commentsOptions } from "@/features/links/queries";
import { apiFor } from "@/utils/orpc";
import { resolveLocation } from "@/lib/routes";
export const Route = createFileRoute("/_app/l/$shortId")({
  loader: async ({ context, location }) => {
    const result = await resolveLocation(location);
    if (result.kind !== "link") throw new Error("Destination not found.");
    const api = apiFor(context.session?.user.id ?? null);
    await context.queryClient.ensureQueryData(linkOptions(api, result.linkId));
    void context.queryClient.prefetchInfiniteQuery(commentsOptions(api, result.linkId));
    return result;
  },
  component: () => <LinkDetail id={Route.useLoaderData().linkId} standalone />,
});
