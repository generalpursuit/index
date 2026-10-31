import { conversationMembers } from "@index/db/schema/app";
import { user } from "@index/db/schema/auth";
import { and, eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { setupApiTests } from "../../testing/api";
import { liveChanges } from "@index/db/schema/live";
import { acknowledge } from "../live/repository";

describe("pulse", () => {
  const api = setupApiTests();
  const previous = new Map<string, string>();
  beforeEach(() => {
    previous.clear();
  });
  const send = (actor: string, conversationId: string, body = "Hello") =>
    api.client(actor).messages.send({ conversationId, clientId: crypto.randomUUID(), body });
  async function pulse(actor: string) {
    const client = api.client(actor);
    const state = await client.pulse.get();
    assert.equal(state.messages.unreadCount, (await client.messages.unread()).unreadCount);
    assert.equal(state.activity.unreadCount, (await client.activity.list({})).unreadCount);
    assert.deepEqual(await client.pulse.get({}), state);
    const version = JSON.stringify([state.messages.version, state.activity.version]);
    const [hint] = await api.db.select().from(liveChanges).where(eq(liveChanges.userId, actor));
    if (previous.has(actor) && previous.get(actor) !== version) {
      assert.ok(hint, "Every pulse change must also durably invalidate the affected account");
    }
    if (hint) await acknowledge(api.db, actor, hint.version);
    previous.set(actor, version);
    return state;
  }
  async function conversation(recipientIds = ["bob"]) {
    const alice = api.client("alice");
    for (const userId of recipientIds) await alice.follows.follow({ userId });
    return alice.messages.createConversation({ recipientIds });
  }

  it("uses four read statements, stays stable when empty and requires authentication", async (t) => {
    const statements = t.mock.method(api.postgres, "query");
    const state = await api.client("alice").pulse.get();
    assert.equal(statements.mock.callCount(), 4);
    for (const call of statements.mock.calls)
      assert.match(String(call.arguments[0]), /^select|^with/i);
    statements.mock.restore();
    assert.deepEqual(state, await pulse("alice"));
    assert.equal(state.messages.unreadCount, 0);
    assert.equal(state.activity.unreadCount, 0);
    await assert.rejects(api.client(null).pulse.get(), { code: "UNAUTHORIZED" });
    await assert.rejects(api.client("alice").pulse.get({ unexpected: true } as never), {
      code: "BAD_REQUEST",
    });
  });

  it("changes for joining, new messages and the viewer's unread state, with account isolation", async () => {
    const before = await pulse("bob");
    const outsider = await pulse("dana");
    const c = await conversation();
    const joined = await pulse("bob");
    assert.notEqual(joined.messages.version, before.messages.version);
    const m = await send("alice", c.id);
    const received = await pulse("bob");
    assert.notEqual(received.messages.version, joined.messages.version);
    assert.equal(received.messages.unreadCount, 1);
    await api.client("bob").messages.markRead({ conversationId: c.id, messageId: m.id });
    const read = await pulse("bob");
    assert.notEqual(read.messages.version, received.messages.version);
    assert.equal(read.messages.unreadCount, 0);
    await api.client("bob").messages.markRead({ conversationId: c.id, messageId: m.id });
    assert.deepEqual(await pulse("bob"), read);
    assert.deepEqual(await pulse("dana"), outsider);
    assert.equal(received.activity.version, joined.activity.version);
  });

  it("changes when every other member reads the viewer's messages and when membership changes", async () => {
    const c = await conversation(["bob", "carol"]);
    const m = await send("alice", c.id);
    const sent = await pulse("alice");
    await api.client("bob").messages.markRead({ conversationId: c.id, messageId: m.id });
    assert.deepEqual(await pulse("alice"), sent, "The sender's receipt is still unchanged");
    await api.client("carol").messages.markRead({ conversationId: c.id, messageId: m.id });
    const read = await pulse("alice");
    assert.notEqual(read.messages.version, sent.messages.version);
    assert.equal(read.messages.unreadCount, sent.messages.unreadCount);
    await api.db
      .delete(conversationMembers)
      .where(
        and(eq(conversationMembers.conversationId, c.id), eq(conversationMembers.userId, "carol")),
      );
    assert.notEqual((await pulse("alice")).messages.version, read.messages.version);
  });

  it("changes with participant identity and visible last-message attachments", async () => {
    const c = await conversation();
    const alice = api.client("alice");
    const group = await alice.groups.create({ name: "Reading" });
    const link = await alice.links.create({
      url: "https://example.com",
      title: "Original",
      groupId: group.id,
    });
    await alice.messages.send({
      conversationId: c.id,
      clientId: crypto.randomUUID(),
      linkId: link.id,
    });
    const visible = await pulse("bob");
    await alice.links.update({ id: link.id, title: "Changed" });
    const edited = await pulse("bob");
    assert.notEqual(edited.messages.version, visible.messages.version);
    await alice.groups.update({ id: group.id, visibility: "private" });
    const hidden = await pulse("bob");
    assert.notEqual(hidden.messages.version, edited.messages.version);
    await alice.links.update({ id: link.id, title: "Private edit" });
    assert.deepEqual(await pulse("bob"), hidden);
    await api.db.update(user).set({ name: "New Alice" }).where(eq(user.id, "alice"));
    assert.notEqual((await pulse("bob")).messages.version, hidden.messages.version);
  });

  it("changes for activity creation, request status and read state", async () => {
    const alice = api.client("alice");
    const empty = await pulse("alice");
    await alice.profiles.update({ profileVisibility: "private" });
    await api.client("bob").follows.follow({ userId: "alice" });
    const pending = await pulse("alice");
    assert.notEqual(pending.activity.version, empty.activity.version);
    assert.equal(pending.activity.unreadCount, 1);
    await alice.follows.accept({ userId: "bob" });
    const accepted = await pulse("alice");
    assert.notEqual(accepted.activity.version, pending.activity.version);
    const item = (await alice.activity.list({})).items[0]!;
    await alice.activity.markRead({ ids: [item.id] });
    const read = await pulse("alice");
    assert.notEqual(read.activity.version, accepted.activity.version);
    assert.equal(read.activity.unreadCount, 0);
    await alice.activity.markRead({ ids: [item.id] });
    assert.deepEqual(await pulse("alice"), read);
    assert.equal(read.messages.version, empty.messages.version);
  });

  it("changes for visible activity edits and cascade deletion", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    const link = await alice.links.create({ url: "https://example.com", title: "Read" });
    const comment = await bob.comments.create({ linkId: link.id, body: "First" });
    const added = await pulse("alice");
    await bob.comments.update({ id: comment.id, body: "Edited" });
    const edited = await pulse("alice");
    assert.notEqual(edited.activity.version, added.activity.version);
    await alice.links.delete({ id: link.id });
    const deleted = await pulse("alice");
    assert.notEqual(deleted.activity.version, edited.activity.version);
    assert.equal(deleted.activity.unreadCount, 0);
  });

  it("applies activity visibility before counts and versions", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob"),
      carol = api.client("carol");
    const group = await alice.groups.create({ name: "Reading" });
    const link = await alice.links.create({
      url: "https://example.com",
      title: "Read",
      groupId: group.id,
    });
    await carol.comments.create({ linkId: link.id, body: "Hello @bob" });
    const visible = await pulse("bob");
    assert.equal(visible.activity.unreadCount, 1);
    await alice.groups.update({ id: group.id, visibility: "private" });
    const hidden = await pulse("bob");
    assert.notEqual(hidden.activity.version, visible.activity.version);
    assert.equal(hidden.activity.unreadCount, 0);
    await bob.follows.follow({ userId: "alice" });
    assert.deepEqual(await pulse("bob"), hidden);
    await alice.groups.update({ id: group.id, visibility: "public" });
    assert.deepEqual(await pulse("bob"), visible);
  });
});
