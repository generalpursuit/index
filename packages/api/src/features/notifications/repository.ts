import { ORPCError } from "@orpc/server";
import { and, eq, notInArray, sql } from "drizzle-orm";
import {
  notificationDevices as devices,
  notificationPreferences as preferences,
  notificationDeliveries as deliveries,
  notificationEvents as events,
  notificationProviderTokens,
} from "@index/db/schema/notifications";
import { session, user } from "@index/db/schema/auth";
import {
  activities,
  comments,
  conversationMembers,
  conversations,
  links,
  messages,
} from "@index/db/schema/app";
import type { QueryDatabase } from "../../data-access/database";
import { linkVisible } from "../../data-access/visibility";
import { defaultPreferences, type Alert, type Preferences, type Registration } from "./schemas";
import { digest, validPushEndpoint } from "./endpoints";

export async function getPreferences(db: QueryDatabase, userId: string): Promise<Preferences> {
  const [row] = await db.select().from(preferences).where(eq(preferences.userId, userId));
  if (!row) return { ...defaultPreferences };
  const { userId: _, ...result } = row;
  return result;
}
export async function updatePreferences(
  db: QueryDatabase,
  userId: string,
  value: Partial<Preferences>,
) {
  if (Object.keys(value).length)
    await db
      .insert(preferences)
      .values({ userId, ...value })
      .onConflictDoUpdate({ target: preferences.userId, set: value });
  return getPreferences(db, userId);
}
export async function ownedDevice(
  db: QueryDatabase,
  userId: string,
  sessionId: string,
  installation: string,
) {
  const [device] = await db
    .select({ device: devices })
    .from(devices)
    .innerJoin(session, and(eq(session.id, devices.sessionId), eq(session.userId, devices.userId)))
    .innerJoin(user, eq(user.id, devices.userId))
    .where(
      and(
        eq(devices.installationHash, await digest(installation)),
        eq(devices.userId, userId),
        eq(devices.sessionId, sessionId),
        eq(user.emailVerified, true),
        sql`${session.expiresAt} > now()`,
      ),
    );
  return device?.device;
}
export async function register(
  db: QueryDatabase,
  userId: string,
  sessionId: string,
  input: Registration,
) {
  if (input.kind === "web" && !validPushEndpoint(input.endpoint))
    throw new ORPCError("BAD_REQUEST", { message: "Unsupported push service." });
  if (input.kind === "web") {
    try {
      const bytes = Uint8Array.from(
        atob(input.p256dh.replaceAll("-", "+").replaceAll("_", "/")),
        (c) => c.charCodeAt(0),
      );
      await crypto.subtle.importKey("raw", bytes, { name: "ECDH", namedCurve: "P-256" }, false, []);
    } catch {
      throw new ORPCError("BAD_REQUEST", { message: "Invalid browser push key." });
    }
  }
  // Fresh persisted identity, including when an in-memory session outlives revocation.
  const [valid] = await db
    .select({ id: session.id })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .where(
      and(
        eq(session.id, sessionId),
        eq(session.userId, userId),
        eq(user.emailVerified, true),
        sql`${session.expiresAt} > now()`,
      ),
    );
  if (!valid) throw new ORPCError("UNAUTHORIZED");
  const installationHash = await digest(input.installation);
  const endpoint =
    input.kind === "web" ? input.endpoint : input.kind === "apns" ? input.token : null;
  const endpointHash = endpoint
    ? await digest(`${input.kind}:${input.kind === "apns" ? input.environment : ""}:${endpoint}`)
    : null;
  const values = {
    installationHash,
    endpointHash,
    userId,
    sessionId,
    kind: input.kind,
    endpoint,
    p256dh: input.kind === "web" ? input.p256dh : null,
    auth: input.kind === "web" ? input.auth : null,
    environment: input.kind === "apns" ? input.environment : null,
  };
  try {
    const [device] = await db
      .insert(devices)
      .values(values)
      .onConflictDoUpdate({ target: devices.installationHash, set: values })
      .returning({ id: devices.id });
    return device!;
  } catch (error) {
    // Never echo endpoint/token/key material in a database error.
    let cause: unknown = error;
    for (let i = 0; i < 4 && cause && typeof cause === "object"; i++) {
      if ("code" in cause && cause.code === "23505")
        throw new ORPCError("CONFLICT", {
          message: "This subscription belongs to another installation. Disable it there first.",
        });
      cause = "cause" in cause ? cause.cause : null;
    }
    throw new ORPCError("INTERNAL_SERVER_ERROR");
  }
}
export async function unregister(
  db: QueryDatabase,
  userId: string,
  sessionId: string,
  installation: string,
) {
  await db
    .delete(devices)
    .where(
      and(
        eq(devices.userId, userId),
        eq(devices.sessionId, sessionId),
        eq(devices.installationHash, await digest(installation)),
      ),
    );
  return { success: true as const };
}
export async function active(
  db: QueryDatabase,
  deviceId: string,
  userId: string,
  conversationId: string | null,
) {
  if (conversationId) {
    const [member] = await db
      .select()
      .from(conversationMembers)
      .where(
        and(
          eq(conversationMembers.userId, userId),
          eq(conversationMembers.conversationId, conversationId),
        ),
      );
    if (!member) throw new ORPCError("NOT_FOUND");
  }
  await db
    .update(devices)
    .set({
      activeConversationId: conversationId,
      activeUntil: conversationId ? sql`now() + interval '45 seconds'` : null,
    })
    .where(eq(devices.id, deviceId));
  return { success: true as const };
}
export type Claim = { id: string; lease: string; attempts: number };
export function claim(
  db: QueryDatabase,
  deviceId: string | null = null,
  limit = 40,
): Promise<Claim[]> {
  return db
    .select({ id: sql<string>`id`, lease: sql<string>`lease`, attempts: sql<number>`attempts` })
    .from(sql`index_notification_claim(${deviceId}::uuid, ${limit})`);
}
export async function renewLease(db: QueryDatabase, job: Claim) {
  const rows = await db
    .update(deliveries)
    .set({ nextAttemptAt: sql`now() + interval '2 minutes'` })
    .where(
      and(
        eq(deliveries.id, job.id),
        eq(deliveries.lease, job.lease),
        eq(deliveries.state, "pending"),
      ),
    )
    .returning({ id: deliveries.id });
  return rows.length > 0;
}
/** A reconnect must recover existing leases without introducing an idle desktop poll. */
export async function nextDeviceAttempt(db: QueryDatabase, deviceId: string, claimed: string[]) {
  const [row] = await db
    .select({ at: sql<Date | string | null>`min(${deliveries.nextAttemptAt})` })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.deviceId, deviceId),
        eq(deliveries.state, "pending"),
        sql`${deliveries.attempts} < 8`,
        claimed.length ? notInArray(deliveries.id, claimed) : undefined,
      ),
    );
  return row?.at ? Math.max(0, Math.ceil((new Date(row.at).getTime() - Date.now()) / 1000)) : null;
}
export async function finish(
  db: QueryDatabase,
  job: Claim,
  state: "delivered" | "discarded" | "failed" | "pending",
  code: string,
  delaySeconds = 0,
) {
  await db
    .update(deliveries)
    .set({
      state,
      outcome: { code },
      lease: null,
      nextAttemptAt: sql`now() + ${delaySeconds} * interval '1 second'`,
    })
    .where(
      and(
        eq(deliveries.id, job.id),
        eq(deliveries.lease, job.lease),
        eq(deliveries.state, "pending"),
      ),
    );
}
const generic = {
  message: "You have a new message.",
  comment: "Someone commented on your link.",
  mention: "Someone mentioned you in a comment.",
  request: "You have a follow request.",
  follow: "You have a new follower.",
  accepted: "Your follow request was accepted.",
};

/** Says what a message without text carries, never which files. */
function filesPreview(types: string[]) {
  if (!types.length) return null;
  const noun = types.every((type) => type.startsWith("image/")) ? "photo" : "file";
  return types.length === 1 ? `Sent a ${noun}.` : `Sent ${types.length} ${noun}s.`;
}

/** Build content only at delivery / notification opening time, never in the outbox. */
export async function prepare(
  db: QueryDatabase,
  deliveryId: string,
  deviceId?: string,
  includeDelivered = false,
  opening = false,
): Promise<{ alert: Alert; device: typeof devices.$inferSelect } | null> {
  const [row] = await db
    .select({ event: events, device: devices })
    .from(deliveries)
    .innerJoin(events, eq(events.id, deliveries.eventId))
    .innerJoin(devices, eq(devices.id, deliveries.deviceId))
    .innerJoin(session, and(eq(session.id, devices.sessionId), eq(session.userId, devices.userId)))
    .innerJoin(user, eq(user.id, devices.userId))
    .where(
      and(
        eq(deliveries.id, deliveryId),
        deviceId ? eq(devices.id, deviceId) : undefined,
        eq(events.recipientId, devices.userId),
        eq(user.emailVerified, true),
        sql`${session.expiresAt} > now()`,
        sql`${events.createdAt} > now() - interval '24 hours'`,
        includeDelivered
          ? sql`${deliveries.state} in ('pending','delivered')`
          : eq(deliveries.state, "pending"),
      ),
    );
  if (!row) return null;
  const { event, device } = row;
  const prefs = await getPreferences(db, event.recipientId);
  if (!prefs[event.category]) return null;
  let path: string,
    preview: string | null = null,
    conversationId: string | null = null;
  if (event.messageId) {
    const fileTypes = sql<
      string[]
    >`(select coalesce(array_agg(f.type), '{}') from message_files f where f.message_id=${messages.id})`;
    const [message] = await db
      .select({
        body: messages.body,
        fileTypes,
        id: conversations.id,
        shortId: conversations.shortId,
        createdAt: messages.createdAt,
        readAt: conversationMembers.readAt,
      })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .innerJoin(
        conversationMembers,
        and(
          eq(conversationMembers.conversationId, messages.conversationId),
          eq(conversationMembers.userId, event.recipientId),
        ),
      )
      .where(eq(messages.id, event.messageId));
    if (!message || (!opening && message.readAt && message.readAt >= message.createdAt))
      return null;
    conversationId = message.id;
    if (
      !opening &&
      device.activeConversationId === message.id &&
      device.activeUntil &&
      device.activeUntil > new Date()
    )
      return null;
    path = `/messages/${message.shortId}`;
    preview = message.body.trim() || filesPreview(message.fileTypes);
    // Deliberately never include forwarded-link title, URL, image or description.
  } else {
    const [activity] = await db
      .select({ activity: activities, username: user.username })
      .from(activities)
      .innerJoin(user, eq(user.id, activities.actorId))
      .where(eq(activities.id, event.activityId!));
    if (!activity || (!opening && activity.activity.readAt)) return null;
    const a = activity.activity;
    if (a.type === "request" && a.requestStatus !== "pending") return null;
    if (a.linkId) {
      const [link] = await db
        .select({ shortId: links.shortId, body: comments.body })
        .from(links)
        .innerJoin(comments, and(eq(comments.linkId, links.id), eq(comments.id, a.commentId!)))
        .where(and(eq(links.id, a.linkId), linkVisible(event.recipientId)));
      if (!link) return null;
      path = `/l/${link.shortId}`;
      preview = link.body;
    } else {
      if (!activity.username) return null;
      path = `/u/${activity.username}`;
    }
  }
  return {
    device,
    alert: {
      id: deliveryId,
      recipientId: event.recipientId,
      title: "Index",
      body:
        prefs.previews && preview?.trim() ? preview.trim().slice(0, 180) : generic[event.category],
      path,
      conversationId,
    },
  };
}
export async function cleanup(db: QueryDatabase) {
  await db
    .delete(notificationProviderTokens)
    .where(sql`${notificationProviderTokens.expiresAt} < now() - interval '1 day'`);
  await db
    .delete(devices)
    .where(
      sql`not exists (select 1 from session s join "user" u on u.id=s.user_id where s.id=${devices.sessionId} and s.user_id=${devices.userId} and s.expires_at > now() and u.email_verified)`,
    );
  await db
    .update(deliveries)
    .set({ state: "failed", lease: null, outcome: { code: "exhausted" } })
    .where(
      and(
        eq(deliveries.state, "pending"),
        sql`${deliveries.attempts} >= 8 and ${deliveries.nextAttemptAt} <= now()`,
      ),
    );
  await db.delete(events).where(sql`${events.createdAt} < now() - interval '7 days'`);
}
