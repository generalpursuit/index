import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

/** Only keyed HMACs of codes are persisted. No plaintext codes or passwords. */
export const authChallenge = pgTable(
  "auth_challenge",
  {
    key: text("key").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    purpose: text("purpose").notNull(),
    email: text("email").notNull(),
    originalEmail: text("original_email").notNull(),
    nonce: text("nonce").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    consumed: boolean("consumed").default(false).notNull(),
    delivery: text("delivery").default("pending").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("auth_challenge_expiry_idx").on(t.expiresAt)],
);

export const authThrottle = pgTable(
  "auth_throttle",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("auth_throttle_expiry_idx").on(t.expiresAt)],
);
