import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupApiTests } from "../../testing/api";
describe("activity", () => {
  const api = setupApiTests();
  it("records follows and requests once, resolves requests, and creates acceptance activity", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    await alice.profiles.update({ profileVisibility: "private" });
    await bob.follows.follow({ userId: "alice" });
    await bob.follows.follow({ userId: "alice" });
    let page = await alice.activity.list({ type: "request" });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]!.requestStatus, "pending");
    await alice.follows.accept({ userId: "bob" });
    await alice.follows.accept({ userId: "bob" });
    assert.equal((await alice.activity.list({})).items[0]!.requestStatus, "accepted");
    assert.equal((await bob.activity.list({ type: "accepted" })).items.length, 1);
    await alice.activity.markRead({ ids: [page.items[0]!.id] });
    assert.equal((await alice.activity.list({})).unreadCount, 0);
    await api.client("carol").follows.follow({ userId: "alice" });
    await alice.follows.reject({ userId: "carol" });
    page = await alice.activity.list({ type: "request" });
    assert.equal(page.items.find((row) => row.actor.id === "carol")!.requestStatus, "declined");
    await api.client("dana").follows.follow({ userId: "alice" });
    await alice.profiles.update({ profileVisibility: "public" });
    assert.equal((await api.client("dana").activity.list({})).items[0]!.type, "accepted");
  });
  it("notifies link owners of comments but never of stars or favorites", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    const group = await alice.groups.create({ name: "Reading" });
    const link = await alice.links.create({
      url: "https://example.com",
      title: "Read",
      groupId: group.id,
    });
    await bob.stars.add({ linkId: link.id });
    await alice.favorites.add({ linkId: link.id });
    assert.equal((await alice.activity.list({})).items.length, 0);
    const comment = await bob.comments.create({ linkId: link.id, body: "Hello" });
    const page = await alice.activity.list({});
    assert.equal(page.items[0]!.body, "Hello");
    assert.equal(page.items[0]!.type, "comment");
    await bob.activity.markRead({ ids: [page.items[0]!.id] });
    assert.equal((await alice.activity.list({})).unreadCount, 1);
    await alice.comments.delete({ id: comment.id });
    assert.equal((await alice.activity.list({})).items.length, 0);
    await assert.rejects(api.client(null).activity.list({}), { code: "UNAUTHORIZED" });
  });
  it("paginates event history and rolls back a comment if its event cannot be written", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    for (const actor of ["bob", "carol", "dana"])
      await api.client(actor).follows.follow({ userId: "alice" });
    const first = await alice.activity.list({ limit: 2 });
    const next = await alice.activity.list({ limit: 2, cursor: first.nextCursor! });
    assert.equal(next.items.length, 1);
    assert.equal(new Set([...first.items, ...next.items].map((i) => i.id)).size, 3);
    const g = await alice.groups.create({ name: "Reading" }),
      l = await alice.links.create({ url: "https://example.com", title: "Read", groupId: g.id });
    await api.postgres
      .exec(`create function reject_activity() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end $$;
   create trigger reject_activity before insert on activities for each row execute function reject_activity();`);
    try {
      await assert.rejects(bob.comments.create({ linkId: l.id, body: "Rollback" }), {
        code: "INTERNAL_SERVER_ERROR",
      });
      assert.equal((await alice.comments.list({ linkId: l.id })).items.length, 0);
    } finally {
      await api.postgres.exec(
        "drop trigger reject_activity on activities; drop function reject_activity();",
      );
    }
  });
});
