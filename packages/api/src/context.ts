import type { Session } from "@memory/auth";
import type { Database } from "@memory/db";

export type Context = {
  session: Session | null;
  db: Database;
};
