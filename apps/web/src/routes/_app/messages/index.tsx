import { createFileRoute } from "@tanstack/react-router";
import { apiFor } from "@/utils/orpc";
import { conversationsOptions } from "@/features/messages/queries";
import { MessagesPage } from "@/features/messages/messages-page";
import { requireSession } from "@/lib/session";
export const Route = createFileRoute("/_app/messages/")({
  beforeLoad: requireSession,
  loader: ({ context }) =>
    context.queryClient.ensureInfiniteQueryData(
      conversationsOptions(apiFor(context.session.user.id)),
    ),
  component: MessagesPage,
});
