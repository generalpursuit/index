import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

export type QueryDatabase = Pick<
  PgAsyncDatabase<PgQueryResultHKT>,
  "selectDistinctOn" | "select" | "insert" | "update" | "delete" | "$with" | "with"
>;
