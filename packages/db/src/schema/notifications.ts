import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user, session } from "./auth";
import { activities, messages } from "./app";

export const notificationCategories = [
  "message",
  "comment",
  "mention",
  "request",
  "follow",
  "accepted",
] as const;
export const notificationPreferences = pgTable("notification_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  message: boolean("message").notNull().default(true),
  comment: boolean("comment").notNull().default(true),
  mention: boolean("mention").notNull().default(true),
  request: boolean("request").notNull().default(true),
  follow: boolean("follow").notNull().default(true),
  accepted: boolean("accepted").notNull().default(true),
  previews: boolean("previews").notNull().default(false),
});

// The installation secret is a possession proof, never an authentication credential.
// Only its SHA-256 digest is stored. Every operation also requires a verified session.
export const notificationDevices = pgTable(
  "notification_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    installationHash: text("installation_hash").notNull().unique(),
    endpointHash: text("endpoint_hash").unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["web", "apns", "desktop"] }).notNull(),
    endpoint: text("endpoint"),
    p256dh: text("p256dh"),
    auth: text("auth"),
    environment: text("environment", { enum: ["sandbox", "production"] }),
    activeConversationId: uuid("active_conversation_id"),
    activeUntil: timestamp("active_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_devices_user_idx").on(t.userId),
    check("notification_device_kind", sql`${t.kind} in ('web','apns','desktop')`),
  ],
);

export const notificationEvents = pgTable(
  "notification_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    category: text("category", { enum: notificationCategories }).notNull(),
    activityId: uuid("activity_id").references(() => activities.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("notification_event_activity_unique").on(t.recipientId, t.activityId),
    unique("notification_event_message_unique").on(t.recipientId, t.messageId),
    check("notification_event_source", sql`(${t.activityId} is null) <> (${t.messageId} is null)`),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => notificationEvents.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => notificationDevices.id, { onDelete: "cascade" }),
    state: text("state", { enum: ["pending", "delivered", "discarded", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lease: uuid("lease"),
    // No message text, destination URL, or serialized alert is persisted here.
    outcome: jsonb("outcome").$type<{ code: string }>(),
  },
  (t) => [
    unique("notification_delivery_unique").on(t.eventId, t.deviceId),
    index("notification_delivery_due_idx").on(t.state, t.nextAttemptAt),
  ],
);

// Short-lived APNs bearer cache shared by Worker isolates. Never exposed by the API.
export const notificationProviderTokens = pgTable("notification_provider_tokens", {
  key: text("key").primaryKey(),
  token: text("token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
