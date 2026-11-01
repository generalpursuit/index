import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { conversations, messages } from "@index/db/schema/app";
import { setupApiTests } from "../../testing/api";

describe("forwarding a link", () => {
  const api = setupApiTests();
  const forward = (linkId: string, recipientId: string, note?: string) => ({
    linkId,
    recipientId,
    note,
    clientId: crypto.randomUUID(),
  });

  it("sends to accepted outgoing follows only, in their one-to-one conversation", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    const link = await alice.links.create({ url: "https://example.com", title: "Read" });
    await assert.rejects(alice.messages.forward(forward(link.id, "bob")), { code: "NOT_FOUND" });
    await bob.profiles.update({ profileVisibility: "private" });
    await alice.follows.follow({ userId: "bob" });
    await assert.rejects(alice.messages.forward(forward(link.id, "bob")), { code: "NOT_FOUND" });
    await assert.rejects(alice.messages.forward(forward(link.id, "alice")), {
      code: "BAD_REQUEST",
    });
    await bob.follows.accept({ userId: "alice" });
    await alice.follows.follow({ userId: "carol" });
    const group = await alice.messages.createConversation({ recipientIds: ["bob", "carol"] });

    const sent = await alice.messages.forward(forward(link.id, "bob", "  Look  "));
    assert.notEqual(sent.conversationId, group.id);
    assert.equal(sent.body, "Look");
    assert.equal(sent.attachment!.id, link.id);
    const [received] = (await bob.messages.list({ conversationId: sent.conversationId })).items;
    assert.equal(received!.id, sent.id);
    const direct = await bob.messages.conversation({ conversationId: sent.conversationId });
    assert.deepEqual(direct.participants.map((person) => person.id).sort(), ["alice", "bob"]);
    // Bob can't forward back: he doesn't follow Alice, though he can still reply there.
    const own = await bob.links.create({ url: "https://example.org", title: "Bob's" });
    await assert.rejects(bob.messages.forward(forward(own.id, "alice")), { code: "NOT_FOUND" });
  });

  it("refuses locked, inaccessible and missing links alike and grants no access", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob"),
      dana = api.client("dana");
    await alice.follows.follow({ userId: "bob" });
    const locked = await alice.groups.create({ name: "Locked", visibility: "private" });
    const own = await alice.links.create({
      url: "https://example.com/own",
      title: "Mine",
      groupId: locked.id,
    });
    const theirs = await bob.groups.create({ name: "Bob's", visibility: "private" });
    const hidden = await bob.links.create({
      url: "https://example.com/hidden",
      title: "Hidden",
      groupId: theirs.id,
    });
    await dana.profiles.update({ profileVisibility: "private" });
    const restricted = await dana.links.create({ url: "https://example.com/dana", title: "Dana" });
    for (const linkId of [own.id, hidden.id, restricted.id, crypto.randomUUID()])
      await assert.rejects(alice.messages.forward(forward(linkId, "bob")), {
        code: "NOT_FOUND",
        message: "Link not found or locked.",
      });
    assert.equal((await api.db.select().from(messages)).length, 0);

    // Alice may see Dana's link as her accepted follower; Bob, who isn't, still may not.
    await alice.follows.follow({ userId: "dana" });
    await dana.follows.accept({ userId: "alice" });
    const sent = await alice.messages.forward(forward(restricted.id, "bob"));
    const [received] = (await bob.messages.list({ conversationId: sent.conversationId })).items;
    assert.equal(received!.attachment, null);
    assert.equal(received!.restrictedAuthor!.id, "dana");
    await assert.rejects(bob.links.get({ id: restricted.id }), { code: "NOT_FOUND" });
  });

  it("converges on retry, including after only the conversation was started", async () => {
    const alice = api.client("alice");
    await alice.follows.follow({ userId: "bob" });
    const link = await alice.links.create({ url: "https://example.com", title: "Read" });
    const input = forward(link.id, "bob", "Look");
    await api.postgres
      .exec(`create function reject_message() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end $$;
      create trigger reject_message before insert on messages for each row execute function reject_message();`);
    try {
      await assert.rejects(alice.messages.forward(input), { code: "INTERNAL_SERVER_ERROR" });
    } finally {
      await api.postgres.exec(
        "drop trigger reject_message on messages; drop function reject_message();",
      );
    }
    assert.equal((await api.db.select().from(conversations)).length, 1);
    assert.equal((await api.db.select().from(messages)).length, 0);

    const sent = await alice.messages.forward(input);
    const retries = await Promise.all([
      alice.messages.forward(input),
      alice.messages.forward(input),
    ]);
    assert.deepEqual(
      retries.map((message) => message.id),
      [sent.id, sent.id],
    );
    assert.equal((await api.db.select().from(conversations)).length, 1);
    assert.equal((await api.db.select().from(messages)).length, 1);

    // A committed forward still answers its retry once the follow and the link are gone.
    await alice.follows.unfollow({ userId: "bob" });
    await alice.links.delete({ id: link.id });
    const retried = await alice.messages.forward(input);
    assert.equal(retried.id, sent.id);
    assert.equal(retried.hasAttachment, true);
    const other = await alice.links.create({ url: "https://example.org", title: "Other" });
    await assert.rejects(alice.messages.forward(forward(other.id, "bob")), { code: "NOT_FOUND" });
  });

  it("rejects a client ID reused for a different payload", async () => {
    const alice = api.client("alice");
    await alice.follows.follow({ userId: "bob" });
    await alice.follows.follow({ userId: "carol" });
    const link = await alice.links.create({ url: "https://example.com", title: "Read" });
    const other = await alice.links.create({ url: "https://example.org", title: "Other" });
    const input = forward(link.id, "bob", "Look");
    await alice.messages.forward(input);
    for (const changed of [
      { note: "Changed" },
      { note: undefined },
      { linkId: other.id },
      { recipientId: "carol" },
    ])
      await assert.rejects(alice.messages.forward({ ...input, ...changed }), { code: "CONFLICT" });

    const group = await alice.messages.createConversation({ recipientIds: ["bob", "carol"] });
    const send = { conversationId: group.id, clientId: crypto.randomUUID(), linkId: link.id };
    await alice.messages.send(send);
    await assert.rejects(
      alice.messages.forward({ linkId: link.id, recipientId: "bob", clientId: send.clientId }),
      { code: "CONFLICT" },
    );
    assert.equal((await api.db.select().from(messages)).length, 2);
  });
});
