import type { NotificationCapabilities } from "./features/notifications/schemas";
import type { Session } from "@index/auth";
import type { QueryDatabase } from "./data-access/database";
import type { FetchPage } from "./features/links/metadata";
import type { MediaStore } from "./features/profiles/media";

export type Context = {
  notifications?: Omit<NotificationCapabilities, "sessionId">;
  session: Session | null;
  db: QueryDatabase;
  /** Fetches public pages to read link titles and categories. */
  fetchPage: FetchPage;
  /** Stores profile photos. */
  media: MediaStore;
};
