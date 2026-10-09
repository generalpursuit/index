import { linkOptions, commentsOptions } from "@/features/links/queries";
import { createFileRoute } from "@tanstack/react-router";
import { LinkDetail } from "@/features/links/link-detail";
import { apiFor } from "@/utils/orpc";
export const Route = createFileRoute("/_app/links/$linkId")({
  loader: async ({ context, params }) => {
    const api = apiFor(context.session?.user.id ?? null);
    void context.queryClient.prefetchInfiniteQuery(commentsOptions(api, params.linkId));
    const link = await context.queryClient.ensureQueryData(linkOptions(api, params.linkId));
    void context.queryClient.prefetchQuery(
      api.profiles.get.queryOptions({ input: { userId: link.ownerId } }),
    );
    return link;
  },
  component: () => <LinkDetail id={Route.useParams().linkId} standalone />,
});
