import type { NotificationCapabilities } from "./features/notifications/schemas";
import type { Session } from "@index/auth";
import type { QueryDatabase } from "./data-access/database";
import type { FetchPage } from "./features/links/metadata";
import type { FileStore } from "./features/messages/files";
import type { MediaStore } from "./features/profiles/media";

export type Context = {
  /** Register recovery before a domain mutation; the returned callback schedules its drain. */
  dispatch?: () => Promise<() => void>;
  live?: {
    ticket: (session: Session) => Promise<{ url: string }>;
    active: (userId: string, sessionId: string, conversationId: string | null) => Promise<void>;
    isActive: (userId: string, sessionId: string, conversationId: string) => Promise<boolean>;
  };
  notifications?: Omit<NotificationCapabilities, "sessionId">;
  session: Session | null;
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
