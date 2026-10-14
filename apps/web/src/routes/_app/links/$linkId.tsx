import { PendingPage } from "@/components/app/query-state";
import { PostPlaceholder } from "@/features/links/link-detail";
import { createFileRoute } from "@tanstack/react-router";
import { resolveLocation } from "@/lib/routes";
export const Route = createFileRoute("/_app/links/$linkId")({
  pendingComponent: () => (
    <PendingPage>
      <PostPlaceholder standalone />
    </PendingPage>
  ),
  loader: ({ context, location }) => resolveLocation(context, location),
});
