import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { Conversation, Person, Profile } from "@/lib/types";
import type { apiFor } from "@/utils/orpc";
import { conversationPath, profilePath } from "@index/api/routes";
import { conversationOptions } from "@/features/messages/queries";
import { placeholderProfile } from "./placeholders";
type API = ReturnType<typeof apiFor>;
export const personSummaryKey = (api: API, id: string) => [...api.profiles.key(), "summary", id];
export function seedPerson(cache: QueryClient, api: API, person: Person) {
  if (!person.id || !person.username || cache.isMutating()) return;
  cache.setQueryData(personSummaryKey(api, person.id), person);
  const path = profilePath(person.username);
  const key = api.routes.resolve.queryOptions({ input: { path } }).queryKey;
  if (!cache.getQueryData(key))
    cache.setQueryData(key as QueryKey, {
      kind: "profile",
      userId: person.id,
      canonicalPath: path,
    });
}
export function profileSummary(cache: QueryClient, api: API, id: string): Profile | undefined {
  const person = cache.getQueryData<Person>(personSummaryKey(api, id));
  return person ? { ...placeholderProfile, ...person, canViewContent: false } : undefined;
}
export function seedConversation(cache: QueryClient, api: API, conversation: Conversation) {
  const options = conversationOptions(api, conversation.id);
  if (!cache.getQueryData(options.queryKey)) {
    const lastMessage = conversation.lastMessage;
    cache.setQueryData(options.queryKey, {
      ...conversation,
      lastMessage:
        lastMessage && "delivery" in lastMessage && lastMessage.delivery === "pending"
          ? null
          : lastMessage,
    });
  }
  const path = conversationPath(conversation.shortId);
  cache.setQueryData(api.routes.resolve.queryOptions({ input: { path } }).queryKey as QueryKey, {
    kind: "conversation",
    conversationId: conversation.id,
    canonicalPath: path,
  });
  for (const person of conversation.participants) seedPerson(cache, api, person);
}
