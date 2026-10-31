import { sql } from "drizzle-orm";
import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Coalesced invalidations, independent of notification permission or device enrollment.
// No FK: deleting an account must still invalidate its already-connected clients.
export const liveChanges = pgTable("live_changes", {
  userId: text("user_id").primaryKey(),
  version: uuid("version").notNull().defaultRandom(),
  sessionChanged: boolean("session_changed").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
