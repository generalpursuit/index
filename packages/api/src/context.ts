import type { Session } from "@index/auth";
import type { QueryDatabase } from "./data-access/database";

export type Context = {
  session: Session | null;
  db: QueryDatabase;
};
