import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ConversationPage } from "@/features/messages/messages-page";
import { requireSession } from "@/lib/session";
import { apiFor } from "@/utils/orpc";
export const Route = createFileRoute("/_app/messages/$conversationId")({
  beforeLoad: requireSession,
  validateSearch: z.object({ attach: z.uuid().optional().catch(undefined) }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      apiFor(context.session.user.id).messages.conversation.queryOptions({
        input: { conversationId: params.conversationId },
      }),
    ),
  component: () => (
    <ConversationPage
      key={Route.useParams().conversationId}
      id={Route.useParams().conversationId}
      attach={Route.useSearch().attach}
    />
  ),
});
