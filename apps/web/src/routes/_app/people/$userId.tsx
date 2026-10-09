import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ProfilePage } from "@/features/profiles/profile-page";
import { apiFor } from "@/utils/orpc";
export const Route = createFileRoute("/_app/people/$userId")({
  validateSearch: z.object({
    group: z
      .union([z.uuid(), z.literal("starred")])
      .optional()
      .catch(undefined),
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      apiFor(context.session?.user.id ?? null).profiles.get.queryOptions({
        input: { userId: params.userId },
      }),
    ),
  component: () => (
    <ProfilePage userId={Route.useParams().userId} group={Route.useSearch().group} />
  ),
});
