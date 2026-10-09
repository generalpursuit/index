import type { Session } from "@index/auth";
import type { QueryDatabase } from "./data-access/database";
import type { FetchPage } from "./features/links/metadata";

export type Context = {
  session: Session | null;
  db: QueryDatabase;
  /** Fetches public pages to read link titles and categories. */
  fetchPage: FetchPage;
};
