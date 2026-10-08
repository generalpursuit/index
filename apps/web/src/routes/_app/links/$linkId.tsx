import { createFileRoute } from "@tanstack/react-router";
import { LinkDetail } from "@/features/links/link-detail";
import { apiFor } from "@/utils/orpc";
export const Route = createFileRoute("/_app/links/$linkId")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      apiFor(context.session?.user.id ?? null).links.get.queryOptions({
        input: { id: params.linkId },
      }),
    ),
  component: () => <LinkDetail id={Route.useParams().linkId} standalone />,
});
