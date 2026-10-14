import { sql } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import type { QueryDatabase } from "../../data-access/database";
import { databaseError } from "../../errors";
import type { CurateeLink } from "./curatee";

/**
 * Saves the curatee links this account hasn't imported before, each on the day it was saved
 * there, and returns how many were saved. The whole import commits or fails together.
 */
export function saveCurateeLinks(db: QueryDatabase, ownerId: string, curatee: CurateeLink[]) {
  const items = curatee.map((link) => ({
    curatee_id: link.curateeId,
    url: link.url,
    title: link.title,
    description: link.description,
    category: link.category,
    created_at: link.createdAt,
  }));
  return ResultAsync.fromPromise(
    db
      .select({
        imported: sql<number>`index_import_curatee(${ownerId}, ${JSON.stringify(items)}::jsonb)`,
      })
      .from(sql`(select 1) as operation`)
      .then((rows) => rows[0]!.imported),
    databaseError,
  );
}
