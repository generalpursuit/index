import { z } from "zod";
import { sql } from "drizzle-orm";
import { err, ok, ResultAsync } from "neverthrow";
import type { QueryDatabase } from "../../data-access/database";
import { databaseError, type ApplicationError } from "../../errors";
import { shareLinkInput } from "./sharing-schemas";
import { readLinkMetadata, type FetchPage } from "./metadata";
import { getLink } from "./service";

type Receipt =
  | { status: "saved" | "existing"; linkId: string }
  | { error: "CONFLICT" | "NOT_FOUND" };

export function shareLink(
  db: QueryDatabase,
  actorId: string,
  input: z.output<typeof shareLinkInput>,
  fetchPage: FetchPage,
) {
  // Metadata is bounded and outside the atomic database operation. The operation itself
  // locks the owner, rechecks the destination, detects duplicates and commits its receipt.
  return ResultAsync.fromSafePromise(readLinkMetadata(input.url, fetchPage))
    .andThen((metadata) =>
      ResultAsync.fromPromise(
        db
          .select({
            receipt: sql<Receipt>`index_share_link(
      ${actorId}, ${input.requestId}::uuid, ${input.url}, ${input.groupId}::uuid,
      ${input.saveAgain}, ${metadata.title}, ${metadata.category})`,
          })
          .from(sql`(select 1) as operation`)
          .then((rows) => rows[0]!.receipt),
        databaseError,
      ),
    )
    .andThen((receipt) => {
      if ("error" in receipt)
        return err<never, ApplicationError>({
          code: receipt.error,
          message:
            receipt.error === "CONFLICT"
              ? "This save request has changed or its link was removed. Start a new save."
              : "Destination unavailable. Choose your links or another group.",
        });
      return getLink(db, actorId, receipt.linkId).andThen((link) =>
        ok({ status: receipt.status, link }),
      );
    });
}
