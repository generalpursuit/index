import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupApiTests } from "../../testing/api";

describe("comment mentions", () => {
  const api = setupApiTests();
  async function setup() {
    for (const name of ["alice", "bob", "carol", "dana"])
      await api.client(name).profiles.update({ username: name });
    const alice = api.client("alice");
    const group = await alice.groups.create({ name: "Reading" });
    const link = await alice.links.create({
      title: "Read",
      url: "https://example.com",
      groupId: group.id,
    });
    return {
      alice,
      bob: api.client("bob"),
      carol: api.client("carol"),
      dana: api.client("dana"),
      group,
      link,
    };
  }

  it("notifies each mentioned reader once, including the owner, without self-notifications", async () => {
    const { alice, bob, carol, dana, link } = await setup();
    const comment = await bob.comments.create({
      linkId: link.id,
      body: "@ALICE @alice @carol @bob @missing",
    });
    const owner = await alice.activity.list({});
    assert.equal(owner.items.length, 1);
    assert.equal(owner.items[0]!.type, "mention");
    assert.equal((await alice.activity.list({ type: "comment" })).items.length, 0);
    const mentions = await carol.activity.list({ type: "mention" });
    assert.equal(mentions.items.length, 1);
    assert.equal(mentions.items[0]!.commentId, comment.id);
    assert.equal(mentions.items[0]!.linkId, link.id);
    assert.equal(mentions.unreadCount, 1);
    assert.equal((await bob.activity.list({})).items.length, 0);
    assert.equal((await dana.activity.list({})).items.length, 0);
    await carol.activity.markRead({ ids: [mentions.items[0]!.id] });
    assert.equal((await carol.activity.list({})).unreadCount, 0);
  });

  it("synchronizes edits without resetting read state and cascades deletions", async () => {
    const { alice, bob, carol, dana, link } = await setup();
    const comment = await bob.comments.create({ linkId: link.id, body: "@alice @carol" });
    const first = (await alice.activity.list({})).items[0]!;
    await alice.activity.markRead({ ids: [first.id] });
    await bob.comments.update({ id: comment.id, body: "@alice @dana" });
    const updated = (await alice.activity.list({})).items[0]!;
    assert.equal(updated.id, first.id);
    assert.ok(updated.readAt);
    assert.equal(updated.body, "@alice @dana");
    assert.equal((await carol.activity.list({})).items.length, 0);
    assert.equal((await dana.activity.list({ type: "mention" })).items.length, 1);
    await bob.comments.update({ id: comment.id, body: "No mentions now" });
    assert.equal((await alice.activity.list({})).items[0]!.type, "comment");
    assert.equal((await dana.activity.list({})).items.length, 0);
    await alice.comments.delete({ id: comment.id });
    assert.equal((await alice.activity.list({})).items.length, 0);
  });

  it("checks access before notifying and again when reading, including unread counts", async () => {
    const { alice, bob, carol, group, link } = await setup();
    await alice.profiles.update({ profileVisibility: "private" });
    await bob.follows.follow({ userId: "alice" });
    await alice.follows.accept({ userId: "bob" });
    await bob.comments.create({ linkId: link.id, body: "@carol" });
    assert.equal((await carol.activity.list({})).items.length, 0);
    await carol.follows.follow({ userId: "alice" });
    await alice.follows.accept({ userId: "carol" });
    await carol.activity.markRead({ ids: (await carol.activity.list({})).items.map((a) => a.id) });
    await bob.comments.create({ linkId: link.id, body: "@carol now visible" });
    assert.equal((await carol.activity.list({ type: "mention" })).unreadCount, 1);
    await carol.follows.unfollow({ userId: "alice" });
    assert.equal((await carol.activity.list({ type: "mention" })).items.length, 0);
    assert.equal((await carol.activity.list({})).unreadCount, 0);
    await alice.groups.update({ id: group.id, visibility: "private" });
    await alice.comments.create({ linkId: link.id, body: "@bob @carol locked" });
    assert.equal((await bob.activity.list({ type: "mention" })).items.length, 0);
    await assert.rejects(bob.comments.create({ linkId: link.id, body: "@carol denied" }), {
      code: "NOT_FOUND",
    });
  });

  it("rolls back both comment creation and editing when a mention event fails", async () => {
    const { alice, bob, carol, link } = await setup();
    const comment = await bob.comments.create({ linkId: link.id, body: "Original" });
    await api.postgres
      .exec(`create function reject_mention() returns trigger language plpgsql as $$ begin
      if NEW.type = 'mention' then raise exception 'test failure'; end if; return NEW; end $$;
      create trigger reject_mention before insert or update on activities for each row execute function reject_mention();`);
    try {
      await assert.rejects(bob.comments.create({ linkId: link.id, body: "@carol new" }), {
        code: "INTERNAL_SERVER_ERROR",
      });
      await assert.rejects(bob.comments.update({ id: comment.id, body: "@carol edit" }), {
        code: "INTERNAL_SERVER_ERROR",
      });
      const comments = (await alice.comments.list({ linkId: link.id })).items;
      assert.equal(comments.length, 1);
      assert.equal(comments[0]!.body, "Original");
      assert.equal((await carol.activity.list({})).items.length, 0);
    } finally {
      await api.postgres.exec(
        "drop trigger reject_mention on activities; drop function reject_mention();",
      );
    }
  });
});
