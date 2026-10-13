import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { messages, conversations, conversationMembers } from "@index/db/schema/app";
import { setupApiTests } from "../../testing/api";
describe("messaging", () => {
  const api = setupApiTests();
  it("reuses exact membership, keeps groups unnamed, and requires accepted outgoing follows", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    await assert.rejects(alice.messages.createConversation({ recipientIds: ["bob"] }), {
      code: "NOT_FOUND",
    });
    await bob.profiles.update({ profileVisibility: "private" });
    await alice.follows.follow({ userId: "bob" });
    await assert.rejects(alice.messages.createConversation({ recipientIds: ["bob"] }), {
      code: "NOT_FOUND",
    });
    await bob.follows.accept({ userId: "alice" });
    await alice.follows.follow({ userId: "carol" });
    const group = await alice.messages.createConversation({ recipientIds: ["bob", "carol"] });
    const retry = await alice.messages.createConversation({ recipientIds: ["carol", "bob"] });
    assert.equal(retry.id, group.id);
    assert.equal(group.participants.length, 3);
    assert.equal("name" in group, false);
    assert.equal((await api.db.select().from(conversations)).length, 1);
    assert.equal((await api.db.select().from(conversationMembers)).length, 3);
    await assert.rejects(api.client("dana").messages.conversation({ conversationId: group.id }), {
      code: "NOT_FOUND",
    });
    assert.equal((await api.client("dana").messages.conversations({})).items.length, 0);
    await assert.rejects(alice.messages.createConversation({ recipientIds: ["alice"] }), {
      code: "BAD_REQUEST",
    });
    await assert.rejects(alice.messages.createConversation({ recipientIds: ["bob", "bob"] }), {
      code: "BAD_REQUEST",
    });
    await assert.rejects(api.client(null).messages.conversations({}), { code: "UNAUTHORIZED" });
  });
  it("sends one message to a group, deduplicates retries, and tracks unread high-water marks", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    await alice.follows.follow({ userId: "bob" });
    await alice.follows.follow({ userId: "carol" });
    const c = await alice.messages.createConversation({ recipientIds: ["bob", "carol"] });
    const input = { conversationId: c.id, clientId: crypto.randomUUID(), body: "Hello" };
    const first = await alice.messages.send(input);
    assert.equal((await alice.messages.send(input)).id, first.id);
    assert.equal((await api.db.select().from(messages)).length, 1);
    assert.equal((await bob.messages.conversation({ conversationId: c.id })).unreadCount, 1);
    assert.equal(
      (await api.client("carol").messages.list({ conversationId: c.id })).items[0]!.id,
      first.id,
    );
    const second = await alice.messages.send({
      ...input,
      clientId: crypto.randomUUID(),
      body: "Two",
    });
    await bob.messages.markRead({ conversationId: c.id, messageId: second.id });
    await bob.messages.markRead({ conversationId: c.id, messageId: first.id });
    assert.equal((await bob.messages.conversation({ conversationId: c.id })).unreadCount, 0);
    assert.equal(
      (await api.client("carol").messages.conversation({ conversationId: c.id })).unreadCount,
      2,
    );
    const page = await bob.messages.list({ conversationId: c.id, limit: 1 });
    assert.equal(page.items[0]!.id, second.id);
    assert.equal(
      (await bob.messages.list({ conversationId: c.id, limit: 1, cursor: page.nextCursor! }))
        .items[0]!.id,
      first.id,
    );
    await assert.rejects(
      api.client("dana").messages.markRead({ conversationId: c.id, messageId: first.id }),
      { code: "NOT_FOUND" },
    );
    await alice.follows.unfollow({ userId: "bob" });
    assert.equal((await alice.messages.conversation({ conversationId: c.id })).canSend, true);
    await alice.messages.send({ ...input, clientId: crypto.randomUUID() });
    await bob.messages.send({
      ...input,
      clientId: crypto.randomUUID(),
      body: "Reply without following",
    });
  });
  it("reports the sender's newest message that every other member has read", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    await alice.follows.follow({ userId: "bob" });
    await alice.follows.follow({ userId: "carol" });
    const direct = await alice.messages.createConversation({ recipientIds: ["bob"] });
    const send = (body: string) =>
      alice.messages.send({ conversationId: direct.id, clientId: crypto.randomUUID(), body });
    const first = await send("First");
    const second = await send("Second");
    const receipt = async () =>
      (await alice.messages.conversation({ conversationId: direct.id })).readReceiptMessageId;
    assert.equal(await receipt(), null);
    await bob.messages.markRead({ conversationId: direct.id, messageId: first.id });
    assert.equal(await receipt(), first.id);
    const answer = await bob.messages.send({
      conversationId: direct.id,
      clientId: crypto.randomUUID(),
      body: "Answer",
    });
    await bob.messages.markRead({ conversationId: direct.id, messageId: answer.id });
    assert.equal(await receipt(), second.id);
    assert.equal(
      (await alice.messages.conversations({})).items[0]!.readReceiptMessageId,
      second.id,
    );
    // Receipts describe the viewer's own messages only.
    const bobReceipt = async () =>
      (await bob.messages.conversation({ conversationId: direct.id })).readReceiptMessageId;
    assert.equal(await bobReceipt(), null);
    await alice.messages.markRead({ conversationId: direct.id, messageId: answer.id });
    assert.equal(await bobReceipt(), answer.id);
    const group = await alice.messages.createConversation({ recipientIds: ["bob", "carol"] });
    const hello = await alice.messages.send({
      conversationId: group.id,
      clientId: crypto.randomUUID(),
      body: "Hello",
    });
    await bob.messages.markRead({ conversationId: group.id, messageId: hello.id });
    const pending = await alice.messages.conversation({ conversationId: group.id });
    assert.equal(pending.readReceiptMessageId, null);
    await api.client("carol").messages.markRead({ conversationId: group.id, messageId: hello.id });
    const read = await alice.messages.conversation({ conversationId: group.id });
    assert.equal(read.readReceiptMessageId, hello.id);
  });
  it("does not grant access through forwarding and redacts originals after revocation or deletion", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    await alice.follows.follow({ userId: "bob" });
    const c = await alice.messages.createConversation({ recipientIds: ["bob"] });
    const group = await alice.groups.create({ name: "Reading" });
    const link = await alice.links.create({
      url: "https://example.com",
      title: "Secret",
      groupId: group.id,
    });
    const message = await alice.messages.send({
      conversationId: c.id,
      clientId: crypto.randomUUID(),
      linkId: link.id,
    });
    assert.equal(
      (await bob.messages.list({ conversationId: c.id })).items[0]!.attachment!.title,
      "Secret",
    );
    await alice.groups.update({ id: group.id, visibility: "private" });
    assert.equal((await bob.messages.list({ conversationId: c.id })).items[0]!.attachment, null);
    assert.equal(
      (await bob.messages.conversation({ conversationId: c.id })).lastMessage!.attachment,
      null,
    );
    await assert.rejects(
      alice.messages.send({ conversationId: c.id, clientId: crypto.randomUUID(), linkId: link.id }),
      { code: "NOT_FOUND" },
    );
    const locked = await alice.groups.create({ name: "Locked", visibility: "private" });
    const hidden = await alice.links.create({
      url: "https://example.com",
      title: "Locked",
      groupId: locked.id,
    });
    await assert.rejects(
      alice.messages.send({
        conversationId: c.id,
        clientId: crypto.randomUUID(),
        linkId: hidden.id,
      }),
      { code: "NOT_FOUND" },
    );
    await alice.links.delete({ id: link.id });
    assert.equal((await bob.messages.list({ conversationId: c.id })).items[0]!.id, message.id);
    assert.equal((await bob.messages.list({ conversationId: c.id })).items[0]!.attachment, null);
    // Links outside any group are shared with the profile, so they can be forwarded.
    const ungrouped = await alice.links.create({ url: "https://example.com", title: "Open" });
    await alice.messages.send({
      conversationId: c.id,
      clientId: crypto.randomUUID(),
      linkId: ungrouped.id,
    });
    assert.equal(
      (await bob.messages.list({ conversationId: c.id })).items[0]!.attachment!.title,
      "Open",
    );
  });
  it("does not partially create a conversation if any recipient is ineligible", async () => {
    const alice = api.client("alice");
    await alice.follows.follow({ userId: "bob" });
    await assert.rejects(alice.messages.createConversation({ recipientIds: ["bob", "dana"] }), {
      code: "NOT_FOUND",
    });
    assert.equal((await api.db.select().from(conversations)).length, 0);
    assert.equal((await api.db.select().from(conversationMembers)).length, 0);
  });
  it("searches conversations by participant and paginates summaries without leaking attachments", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    await alice.follows.follow({ userId: "bob" });
    await alice.follows.follow({ userId: "carol" });
    const direct = await alice.messages.createConversation({ recipientIds: ["bob"] });
    const group = await alice.messages.createConversation({ recipientIds: ["bob", "carol"] });
    await alice.messages.send({
      conversationId: direct.id,
      clientId: crypto.randomUUID(),
      body: "Direct",
    });
    await alice.messages.send({
      conversationId: group.id,
      clientId: crypto.randomUUID(),
      body: "Group",
    });
    const first = await bob.messages.conversations({ limit: 1 });
    assert.equal(first.items[0]!.lastMessage!.body, "Group");
    assert.equal(first.items[0]!.participants.length, 3);
    const second = await bob.messages.conversations({ limit: 1, cursor: first.nextCursor! });
    assert.equal(second.items[0]!.id, direct.id);
    assert.equal((await alice.messages.conversations({ query: "Carol" })).items.length, 1);
    assert.equal((await alice.messages.conversations({ query: "%" })).items.length, 0);
    assert.equal((await bob.messages.unread()).unreadCount, 2);
    assert.equal(
      (await alice.follows.following({ userId: "alice", query: "Bob" })).items.length,
      1,
    );
  });
  it("rejects mismatched retry keys and rolls back a send if updating the inbox fails", async () => {
    const alice = api.client("alice");
    await alice.follows.follow({ userId: "bob" });
    const c = await alice.messages.createConversation({ recipientIds: ["bob"] });
    const input = { conversationId: c.id, clientId: crypto.randomUUID(), body: "Original" };
    await alice.messages.send(input);
    await assert.rejects(alice.messages.send({ ...input, body: "Changed" }), { code: "NOT_FOUND" });
    await api.postgres
      .exec(`create function reject_inbox_update() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end $$;
   create trigger reject_inbox_update before update on conversations for each row execute function reject_inbox_update();`);
    try {
      await assert.rejects(alice.messages.send({ ...input, clientId: crypto.randomUUID() }), {
        code: "INTERNAL_SERVER_ERROR",
      });
      assert.equal((await alice.messages.list({ conversationId: c.id })).items.length, 1);
    } finally {
      await api.postgres.exec(
        "drop trigger reject_inbox_update on conversations; drop function reject_inbox_update();",
      );
    }
  });
  it("returns restricted identity per recipient until follow approval, without exposing post metadata", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob"),
      carol = api.client("carol"),
      dana = api.client("dana");
    await dana.profiles.update({ profileVisibility: "private" });
    for (const actor of [alice, bob]) {
      await actor.follows.follow({ userId: "dana" });
    }
    await dana.follows.accept({ userId: "alice" });
    await dana.follows.accept({ userId: "bob" });
    await alice.follows.follow({ userId: "bob" });
    await alice.follows.follow({ userId: "carol" });
    const c = await alice.messages.createConversation({ recipientIds: ["bob", "carol"] });
    const g = await dana.groups.create({ name: "Reading" });
    const l = await dana.links.create({
      url: "https://example.com",
      title: "Followers",
      groupId: g.id,
    });
    await alice.messages.send({
      conversationId: c.id,
      clientId: crypto.randomUUID(),
      linkId: l.id,
    });
    const hidden = (await carol.messages.list({ conversationId: c.id })).items[0]!;
    assert.equal(hidden.attachment, null);
    assert.equal(hidden.hasAttachment, true);
    assert.equal(hidden.restrictedAuthor?.id, "dana");
    assert.equal(JSON.stringify(hidden).includes(l.url), false);
    assert.equal(JSON.stringify(hidden).includes(l.title), false);
    assert.equal(
      (await bob.messages.list({ conversationId: c.id })).items[0]!.attachment?.id,
      l.id,
    );
    await carol.follows.follow({ userId: "dana" });
    await dana.follows.accept({ userId: "carol" });
    await alice.messages.send({
      conversationId: c.id,
      clientId: crypto.randomUUID(),
      linkId: l.id,
    });
    await dana.follows.removeFollower({ userId: "bob" });
    assert.equal((await bob.messages.conversations({})).items[0]!.lastMessage!.attachment, null);
    assert.equal(
      (await carol.messages.list({ conversationId: c.id })).items[0]!.attachment!.id,
      l.id,
    );
    await dana.groups.update({ id: g.id, visibility: "private" });
    assert.equal(
      (await carol.messages.list({ conversationId: c.id })).items[0]!.restrictedAuthor,
      null,
    );
    await assert.rejects(dana.messages.createConversation({ recipientIds: ["alice"] }), {
      code: "NOT_FOUND",
    });
    await dana.follows.follow({ userId: "alice" });
    const ownChat = await dana.messages.createConversation({ recipientIds: ["alice"] });
    await assert.rejects(
      dana.messages.send({
        conversationId: ownChat.id,
        clientId: crypto.randomUUID(),
        linkId: l.id,
      }),
      { code: "NOT_FOUND" },
    );
    await dana.links.delete({ id: l.id });
    const removed = (await carol.messages.list({ conversationId: c.id })).items[0]!;
    assert.equal(removed.hasAttachment, true);
    assert.equal(removed.attachment, null);
    assert.equal(removed.restrictedAuthor, null);
  });
});
