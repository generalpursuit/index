import { createFileRoute } from "@tanstack/react-router";
import { LinkDetail } from "@/features/links/link-detail";
import { loadPost } from "@/features/links/queries";
import { apiFor } from "@/utils/orpc";
import { resolveLocation } from "@/lib/routes";
export const Route = createFileRoute("/_app/l/$shortId")({
  loader: async ({ context, location }) => {
    const result = await resolveLocation(context, location);
    if (result.kind !== "link") throw new Error("Destination not found.");
    await loadPost(context.queryClient, apiFor(context.session?.user.id ?? null), result.linkId);
    return result;
  },
  component: () => <LinkDetail id={Route.useLoaderData().linkId} standalone />,
});
