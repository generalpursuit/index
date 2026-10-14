import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { links } from "./app";

// One row per curatee link an account has imported. Rows deliberately survive link deletion,
// so importing the same profile again adds only new links and never brings a deleted one back.
export const curateeImports = pgTable(
  "curatee_imports",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    curateeId: uuid("curatee_id").notNull(),
    linkId: uuid("link_id").references(() => links.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.curateeId] })],
);
