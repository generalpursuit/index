import type { Session } from "@index/auth";
import type { Database } from "@index/db";

export type Context = {
  session: Session | null;
  db: Database;
};
