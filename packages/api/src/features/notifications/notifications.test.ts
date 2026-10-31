import { providerToken } from "./provider-tokens";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { session, user } from "@index/db/schema/auth";
import {
  notificationDeliveries as jobs,
  notificationDevices as devices,
  notificationEvents as events,
} from "@index/db/schema/notifications";
import { createTestDatabase } from "../../testing/database";
import { appRouter } from "../../routers";
import { deliverBatch } from "./delivery";
import { claim, prepare, renewLease } from "./repository";
import { validPushEndpoint } from "./endpoints";
const secret = (c: string) => c.repeat(43);
describe("durable notifications", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  before(async () => {
    fixture = await createTestDatabase();
  });
  after(async () => {
    await fixture.close();
  });
  beforeEach(async () => {
    await fixture.reset();
    await fixture.db.insert(session).values(
      ["alice", "bob"].map((id) => ({
        id: `session-${id}`,
        userId: id,
        token: `fixture-${id}`,
        expiresAt: new Date(Date.now() + 86400_000),
        updatedAt: new Date(),
      })),
    );
  });
  const api = (id: string | null) =>
    createRouterClient(appRouter, {
      context: {
        ...fixture.context(id),
        notifications: {
          web: true,
          apns: true,
          apnsEnvironment: "sandbox",
          desktop: true,
          vapidPublicKey: "fixture",
        },
      },
    });
  async function enroll(id = "bob", installation = secret("b"), kind: "apns" | "desktop" = "apns") {
    return api(id).notifications.register(
      kind === "apns"
        ? {
            kind,
            installation,
            token: "a".repeat(64),
            environment: "sandbox",
            sessionId: `session-${id}`,
          }
        : { kind, installation, sessionId: `session-${id}` },
    );
  }
  async function message(body = "PRIVATE message text") {
    await api("alice").follows.follow({ userId: "bob" });
    const c = await api("alice").messages.createConversation({ recipientIds: ["bob"] });
    const input = { conversationId: c.id, clientId: crypto.randomUUID(), body };
    const m = await api("alice").messages.send(input);
    return { m, c, input };
  }
  const due = () =>
    fixture.client.exec(
      "update notification_deliveries set next_attempt_at=now() - interval '1 second'",
    );
  it("defaults categories on and previews off without opting devices in; preferences retain activity", async () => {
    const initial = await api("bob").notifications.preferences({});
    assert.equal(initial.previews, false);
    assert.equal(initial.message, true);
    assert.equal((await fixture.db.select().from(devices)).length, 0);
    await api("bob").notifications.updatePreferences({ follow: false });
    await api("alice").follows.follow({ userId: "bob" });
    assert.equal((await api("bob").activity.list({})).items.length, 1);
    assert.equal((await fixture.db.select().from(jobs)).length, 0);
    await enroll(); // no historical notification replay on opt-in
    assert.equal((await fixture.db.select().from(jobs)).length, 0);
    assert.equal((await api("bob").notifications.preferences({})).follow, false);
  });
  it("requires a verified, persisted owning session and possession of the installation", async () => {
    await assert.rejects(
      api(null).notifications.register({
        kind: "desktop",
        installation: secret("b"),
        sessionId: "session-bob",
      }),
      { code: "UNAUTHORIZED" },
    );
    await enroll();
    assert.equal(
      (
        await api("alice").notifications.status({
          installation: secret("b"),
          sessionId: "session-alice",
        })
      ).registered,
      false,
    );
    await api("alice").notifications.unregister({
      installation: secret("b"),
      sessionId: "session-alice",
    });
    assert.equal((await fixture.db.select().from(devices)).length, 1);
    await fixture.db.update(user).set({ emailVerified: false }).where(eq(user.id, "bob"));
    await assert.rejects(enroll(), { code: "UNAUTHORIZED" });
    assert.equal(
      (
        await api("bob").notifications.status({
          installation: secret("b"),
          sessionId: "session-bob",
        })
      ).registered,
      false,
    );
    await assert.rejects(
      api("bob").notifications.poll({ installation: secret("b"), sessionId: "session-bob" }),
      { code: "NOT_FOUND" },
    );
  });
  it("deduplicates transactional messages, jobs and claims; suppresses self events", async () => {
    await enroll();
    const { input } = await message();
    await api("alice").messages.send(input);
    const rows = await fixture.db.select().from(events);
    assert.equal(rows.filter((r) => r.category === "message").length, 1);
    assert.equal(
      rows.every((r) => r.recipientId === "bob"),
      true,
    );
    const first = await claim(fixture.db);
    const second = await claim(fixture.db);
    assert.equal(first.length, 2);
    assert.equal(second.length, 0);
    await due();
    assert.equal((await claim(fixture.db)).length, 2);
  });
  it("does not renew a superseded claim after an interrupted worker recovers", async () => {
    await enroll();
    await api("alice").follows.follow({ userId: "bob" });
    const [old] = await claim(fixture.db);
    await due();
    const [recovered] = await claim(fixture.db);
    assert.equal(old!.id, recovered!.id);
    assert.notEqual(old!.lease, recovered!.lease);
    assert.equal(await renewLease(fixture.db, old!), false);
    assert.equal(await renewLease(fixture.db, recovered!), true);
    assert.equal((await claim(fixture.db)).length, 0);
  });
  it("keeps a newly rebound installation when the old provider reports a dead token", async () => {
    await enroll();
    await api("alice").follows.follow({ userId: "bob" });
    await deliverBatch(fixture.db, async () => {
      await enroll("alice", secret("b"));
      return { status: "dead" };
    });
    assert.equal((await fixture.db.select().from(devices))[0]!.userId, "alice");
  });
  it("hides a pending mention when its group is locked before delivery", async () => {
    await enroll("bob", secret("b"), "desktop");
    const group = await api("alice").groups.create({ name: "Private later" });
    const link = await api("alice").links.create({
      url: "https://example.com/locked",
      groupId: group.id,
    });
    await api("alice").comments.create({ linkId: link.id, body: "@bob PRIVATE group comment" });
    await api("alice").groups.update({ id: group.id, visibility: "private" });
    const alerts = await api("bob").notifications.poll({
      installation: secret("b"),
      sessionId: "session-bob",
    });
    assert.equal(alerts.items.length, 0);
  });
  it("reads current previews and category preferences at delivery, never stores bodies", async () => {
    await enroll();
    await message();
    const delivered: unknown[] = [];
    await deliverBatch(fixture.db, async (_d, alert) => {
      delivered.push(alert);
      return { status: "sent" };
    });
    assert.equal(JSON.stringify(delivered).includes("PRIVATE"), false);
    assert.equal(JSON.stringify(await fixture.db.select().from(jobs)).includes("PRIVATE"), false);
    await api("bob").notifications.updatePreferences({ previews: true });
    await message("Opted in preview");
    const previews: string[] = [];
    await deliverBatch(fixture.db, async (_d, alert) => {
      previews.push(alert.body);
      return { status: "sent" };
    });
    assert.deepEqual(previews, ["Opted in preview"]);
    await message("Do not deliver");
    await api("bob").notifications.updatePreferences({ message: false });
    let sent = 0;
    await deliverBatch(fixture.db, async () => {
      sent++;
      return { status: "sent" };
    });
    assert.equal(sent, 0);
  });
  it("previews a message without text by what it carries, never by file names", async () => {
    // Following first, so the follow alert is queued before Bob has a device to receive it.
    await api("alice").follows.follow({ userId: "bob" });
    await enroll();
    await api("bob").notifications.updatePreferences({ previews: true });
    const c = await api("alice").messages.createConversation({ recipientIds: ["bob"] });
    const png = () =>
      new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "secret.png");
    const pdf = () => new File(["%PDF-1.4"], "secret.pdf");
    async function sendFiles(body: string, ...files: File[]) {
      const fileIds = [];
      for (const file of files)
        fileIds.push((await api("alice").messages.upload({ conversationId: c.id, file })).id);
      await api("alice").messages.send({
        conversationId: c.id,
        clientId: crypto.randomUUID(),
        body,
        fileIds,
      });
    }
    async function previews() {
      const bodies: string[] = [];
      await deliverBatch(fixture.db, async (_d, alert) => {
        bodies.push(alert.body);
        return { status: "sent" };
      });
      return bodies;
    }
    await sendFiles("", png());
    assert.deepEqual(await previews(), ["Sent a photo."]);
    await sendFiles("", png(), png(), png());
    assert.deepEqual(await previews(), ["Sent 3 photos."]);
    await sendFiles("", pdf());
    assert.deepEqual(await previews(), ["Sent a file."]);
    await sendFiles("", png(), pdf());
    assert.deepEqual(await previews(), ["Sent 2 files."]);
    await sendFiles("Dinner at eight", png());
    assert.deepEqual(await previews(), ["Dinner at eight"]);
  });
  it("does not disclose comments after locking links or revoking profile access", async () => {
    await enroll("alice", secret("a"));
    const group = await api("alice").groups.create({ name: "Notes" });
    const link = await api("alice").links.create({
      url: "https://example.com",
      title: "secret",
      groupId: group.id,
    });
    await api("bob").comments.create({ linkId: link.id, body: "Hidden comment" });
    await api("alice").groups.update({ id: group.id, visibility: "private" });
    // Owner still has access, then delete the comment's target to remove every job atomically.
    await api("alice").links.delete({ id: link.id });
    assert.equal((await fixture.db.select().from(jobs)).length, 0);
    await enroll("bob", secret("b"), "desktop");
    const publicLink = await api("alice").links.create({ url: "https://example.com/public" });
    await api("alice").comments.create({ linkId: publicLink.id, body: "@bob private mention" });
    await api("alice").profiles.update({ profileVisibility: "private" });
    const result = await api("bob").notifications.poll({
      installation: secret("b"),
      sessionId: "session-bob",
    });
    assert.equal(result.items.length, 0);
    assert.equal(
      (await fixture.db.select().from(jobs)).some((r) => r.state === "discarded"),
      true,
    );
  });
  it("checks active conversation, read receipts and membership on every attempt", async () => {
    await enroll("bob", secret("b"), "desktop");
    const { c } = await message();
    await api("bob").notifications.active({
      installation: secret("b"),
      sessionId: "session-bob",
      conversationId: c.id,
    });
    let result = await api("bob").notifications.poll({
      installation: secret("b"),
      sessionId: "session-bob",
    });
    assert.equal(
      result.items.some((r) => r.alert.conversationId === c.id),
      false,
    );
    await api("bob").notifications.active({
      installation: secret("b"),
      sessionId: "session-bob",
      conversationId: null,
    });
    const { m } = await message();
    await api("bob").messages.markRead({ conversationId: c.id, messageId: m.id });
    result = await api("bob").notifications.poll({
      installation: secret("b"),
      sessionId: "session-bob",
    });
    assert.equal(result.items.length, 0);
    await message();
    await fixture.client.query(
      "delete from conversation_members where user_id='bob' and conversation_id=$1",
      [c.id],
    );
    assert.equal(
      (await api("bob").notifications.poll({ installation: secret("b"), sessionId: "session-bob" }))
        .items.length,
      0,
    );
  });
  it("retries durably with stable identity and cleans dead endpoints without deleting history", async () => {
    await enroll();
    await api("alice").follows.follow({ userId: "bob" });
    const ids: string[] = [];
    await deliverBatch(fixture.db, async (_d, a) => {
      ids.push(a.id);
      return { status: "retry", retryAfter: 120 };
    });
    assert.equal((await claim(fixture.db)).length, 0);
    await due();
    await deliverBatch(fixture.db, async (_d, a) => {
      ids.push(a.id);
      return { status: "dead" };
    });
    assert.equal(ids[0], ids[1]);
    assert.equal((await fixture.db.select().from(devices)).length, 0);
    assert.equal((await api("bob").activity.list({})).items.length, 1);
  });
  it("passes only transport data and stores safe provider diagnostics without changing retry ownership", async () => {
    await enroll();
    await api("alice").follows.follow({ userId: "bob" });
    await deliverBatch(fixture.db, async (destination) => {
      assert.deepEqual(destination, {
        kind: "apns",
        token: "a".repeat(64),
        environment: "sandbox",
      });
      return { status: "retry", reason: "provider_authentication", retryAfter: 120 };
    });
    const [job] = await fixture.db.select().from(jobs);
    assert.equal(job!.state, "pending");
    assert.deepEqual(job!.outcome, { code: "provider_authentication" });
    assert.equal((await fixture.db.select().from(devices)).length, 1);
    assert.equal((await claim(fixture.db)).length, 0);
  });
  it("binds desktop claims and acknowledgements to the owning account and lease", async () => {
    await enroll("bob", secret("b"), "desktop");
    await message();
    const result = await api("bob").notifications.poll({
      installation: secret("b"),
      sessionId: "session-bob",
    });
    const item = result.items[0]!;
    await assert.rejects(
      api("alice").notifications.ack({
        installation: secret("b"),
        sessionId: "session-bob",
        id: item.alert.id,
        lease: item.lease,
      }),
      { code: "UNAUTHORIZED" },
    );
    await api("bob").notifications.ack({
      installation: secret("b"),
      sessionId: "session-bob",
      id: item.alert.id,
      lease: crypto.randomUUID(),
    });
    assert.equal(
      (await fixture.db.select().from(jobs).where(eq(jobs.id, item.alert.id)))[0]!.state,
      "pending",
    );
    await api("bob").notifications.ack({
      installation: secret("b"),
      sessionId: "session-bob",
      id: item.alert.id,
      lease: item.lease,
    });
    assert.equal(
      (await fixture.db.select().from(jobs).where(eq(jobs.id, item.alert.id)))[0]!.state,
      "delivered",
    );
  });
  it("returns a deadline for interrupted desktop leases and no timer for an empty queue", async () => {
    await enroll("bob", secret("b"), "desktop");
    await message();
    const input = { installation: secret("b"), sessionId: "session-bob" };
    const first = await api("bob").notifications.poll(input);
    assert.ok(first.items.length > 0);
    assert.equal(first.retryAfterSeconds, null);
    const interrupted = await api("bob").notifications.poll(input);
    assert.equal(interrupted.items.length, 0);
    assert.ok(interrupted.retryAfterSeconds! > 0 && interrupted.retryAfterSeconds! <= 121);
    await due();
    const recovered = await api("bob").notifications.poll(input);
    assert.deepEqual(
      recovered.items.map((item) => item.alert.id).sort(),
      first.items.map((item) => item.alert.id).sort(),
    );
    for (const item of recovered.items)
      await api("bob").notifications.ack({ ...input, id: item.alert.id, lease: item.lease });
    const idle = await api("bob").notifications.poll(input);
    assert.equal(idle.retryAfterSeconds, null);
    assert.equal(idle.hasMore, false);
  });
  it("drains a full discarded desktop batch without waiting for another event", async () => {
    await enroll("bob", secret("b"), "desktop");
    const { c } = await message();
    await api("bob").notifications.updatePreferences({ message: false, follow: false });
    for (let i = 0; i < 20; i++)
      await api("alice").messages.send({
        conversationId: c.id,
        clientId: crypto.randomUUID(),
        body: "Muted",
      });
    const input = { installation: secret("b"), sessionId: "session-bob" };
    const first = await api("bob").notifications.poll(input);
    assert.equal(first.items.length, 0);
    assert.equal(first.hasMore, true);
    const rest = await api("bob").notifications.poll(input);
    assert.equal(rest.items.length, 0);
    assert.equal(rest.hasMore, false);
    assert.equal(rest.retryAfterSeconds, null);
  });
  it("clears queued work when rebinding a proven installation; rejects endpoint theft", async () => {
    await enroll();
    await message();
    await assert.rejects(enroll("alice", secret("x")), { code: "CONFLICT" });
    await enroll("alice", secret("b"));
    assert.equal((await fixture.db.select().from(jobs)).length, 0);
    assert.equal(
      (
        await api("bob").notifications.status({
          installation: secret("b"),
          sessionId: "session-bob",
        })
      ).registered,
      false,
    );
  });
  it("creates all six categories and cancels obsolete follow requests at send time", async () => {
    await enroll("alice", secret("a"), "desktop");
    await enroll("bob", secret("b"), "desktop");
    await api("alice").profiles.update({ profileVisibility: "private" });
    await api("bob").follows.follow({ userId: "alice" });
    await api("alice").follows.accept({ userId: "bob" });
    await api("alice").follows.follow({ userId: "bob" });
    const link = await api("bob").links.create({ url: "https://example.com/comments" });
    await api("alice").comments.create({ linkId: link.id, body: "PRIVATE comment" });
    const own = await api("alice").links.create({ url: "https://example.com/mention" });
    await api("alice").comments.create({ linkId: own.id, body: "@bob PRIVATE mention" });
    await message();
    assert.deepEqual(
      [...new Set((await fixture.db.select().from(events)).map((e) => e.category))].sort(),
      ["accepted", "comment", "follow", "mention", "message", "request"].sort(),
    );
    const staleRequest = await api("alice").notifications.poll({
      installation: secret("a"),
      sessionId: "session-alice",
    });
    assert.equal(
      staleRequest.items.some((item) => item.alert.body === "You have a follow request."),
      false,
    );
    const alerts = await api("bob").notifications.poll({
      installation: secret("b"),
      sessionId: "session-bob",
    });
    assert.equal(JSON.stringify(alerts).includes("PRIVATE"), false);
    assert.equal(
      alerts.items.some((item) => item.alert.path.startsWith("/l/")),
      true,
    );
  });
  it("rejects delayed registration from a previous login and bounds retries", async () => {
    await assert.rejects(
      api("bob").notifications.register({
        kind: "desktop",
        installation: secret("b"),
        sessionId: "session-alice",
      }),
      { code: "UNAUTHORIZED" },
    );
    await enroll();
    await api("alice").follows.follow({ userId: "bob" });
    let attempts = 0;
    for (let i = 0; i < 10; i++) {
      await due();
      await deliverBatch(fixture.db, async () => {
        attempts++;
        throw new Error("Fake offline adapter");
      });
    }
    assert.equal(attempts, 8);
    assert.equal((await fixture.db.select().from(jobs))[0]!.state, "failed");
  });
  it("shares one APNs token across concurrent worker isolates and renews expired tokens", async () => {
    const key = crypto.randomUUID();
    const [a, b] = await Promise.all([
      providerToken(fixture.db, key, async () => "fixture-a"),
      providerToken(fixture.db, key, async () => "fixture-b"),
    ]);
    assert.equal(a, b);
    assert.equal(
      await providerToken(fixture.db, key, async () => {
        throw new Error("Should reuse token");
      }),
      a,
    );
    await fixture.client.query(
      "update notification_provider_tokens set expires_at=now() where key=$1",
      [key],
    );
    assert.equal(await providerToken(fixture.db, key, async () => "fixture-new"), "fixture-new");
  });
  it("rolls back outbox rows with their source mutation", async () => {
    await enroll("bob", secret("b"), "desktop");
    await fixture.client.exec(
      "BEGIN; INSERT INTO activities (recipient_id,actor_id,type) VALUES ('bob','alice','follow'); ROLLBACK;",
    );
    assert.equal((await fixture.db.select().from(events)).length, 0);
    assert.equal((await fixture.db.select().from(jobs)).length, 0);
  });
  it("drops expired/revoked sessions and never sends disabled previews in canonical paths", async () => {
    await enroll();
    await message();
    const [job] = await fixture.db.select().from(jobs);
    const alert = (await prepare(fixture.db, job!.id))!.alert;
    assert.match(alert.path, /^\/(u|messages)\/[a-zA-Z0-9_-]+$/);
    await fixture.db.delete(session).where(eq(session.id, "session-bob"));
    let sent = 0;
    await deliverBatch(fixture.db, async () => {
      sent++;
      return { status: "sent" };
    });
    assert.equal(sent, 0);
    assert.equal((await fixture.db.select().from(devices)).length, 0);
  });
});
it("restricts web push destinations to HTTPS providers and rejects SSRF/redirect origins", () => {
  for (const url of [
    "http://fcm.googleapis.com/a",
    "https://fcm.googleapis.com.evil.test/a",
    "https://user@fcm.googleapis.com/a",
    "https://127.0.0.1/a",
    "https://fcm.googleapis.com:8443/a",
  ])
    assert.equal(validPushEndpoint(url), false);
  assert.equal(validPushEndpoint("https://fcm.googleapis.com/fcm/send/test"), true);
});
