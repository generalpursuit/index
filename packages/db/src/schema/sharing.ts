import { pgTable, text, uuid, boolean, primaryKey, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { links } from "./app";

// Receipts deliberately survive link deletion, so an uncertain retry cannot resurrect it.
export const shareReceipts = pgTable(
  "share_receipts",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    payload: text("payload").notNull(),
    linkId: uuid("link_id").references(() => links.id, { onDelete: "set null" }),
    saved: boolean("saved").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.requestId] })],
);
