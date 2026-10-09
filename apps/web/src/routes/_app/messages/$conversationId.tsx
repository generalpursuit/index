import { conversationOptions, messagesOptions } from "@/features/messages/queries";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ConversationPage } from "@/features/messages/messages-page";
import { requireSession } from "@/lib/session";
import { apiFor } from "@/utils/orpc";
export const Route = createFileRoute("/_app/messages/$conversationId")({
  beforeLoad: requireSession,
  validateSearch: z.object({ attach: z.uuid().optional().catch(undefined) }),
  loader: ({ context, params }) => {
    const api = apiFor(context.session.user.id);
    return Promise.all([
      context.queryClient.ensureQueryData(conversationOptions(api, params.conversationId)),
      context.queryClient.ensureInfiniteQueryData(messagesOptions(api, params.conversationId)),
    ]);
  },
  component: () => (
    <ConversationPage
      key={Route.useParams().conversationId}
      id={Route.useParams().conversationId}
      attach={Route.useSearch().attach}
    />
  ),
});
