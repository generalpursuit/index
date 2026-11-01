import type { NotificationCapabilities } from "./features/notifications/schemas";
import type { McpAccess, Session } from "@index/auth";
import type { QueryDatabase } from "./data-access/database";
import type { FetchPage } from "./features/links/metadata";
import type { FileStore } from "./features/messages/files";
import type { MediaStore } from "./features/profiles/media";

/**
 * Who a request acts for: the account itself through a Better Auth session, or an app the
 * account connected over OAuth, which may call only the agent tools its grant allows. Both
 * act as the account and follow the same visibility rules.
 */
export type Caller =
  | { kind: "session"; userId: string; session: Session }
  | ({ kind: "agent" } & McpAccess);

export function sessionCaller(session: Session | null): Caller | null {
  return session && { kind: "session", userId: session.user.id, session };
}

export type Context = {
  /** Register recovery before a domain mutation; the returned callback schedules its drain. */
  dispatch?: () => Promise<() => void>;
  live?: {
    ticket: (session: Session) => Promise<{ url: string }>;
    active: (userId: string, sessionId: string, conversationId: string | null) => Promise<void>;
    isActive: (userId: string, sessionId: string, conversationId: string) => Promise<boolean>;
  };
  notifications?: Omit<NotificationCapabilities, "sessionId">;
  /** Null for anonymous requests. */
  caller: Caller | null;
  db: QueryDatabase;
  /** Fetches public pages to read link titles and categories. */
  fetchPage: FetchPage;
  /** Reads the services links are imported from, uncached so each import sees new links. */
  fetchImport: FetchPage;
  /** Stores profile photos. */
  media: MediaStore;
  /** Stores files shared in conversations. */
  files: FileStore;
};
