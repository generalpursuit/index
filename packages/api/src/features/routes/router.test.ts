import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sql } from "drizzle-orm";
import { setupApiTests } from "../../testing/api";

describe("canonical route resolution", () => {
  const api = setupApiTests();
  it("resolves profile and group rename chains including legacy IDs to current canonical paths", async () => {
    const alice = api.client("alice"),
      guest = api.client(null);
    const group = await alice.groups.create({ name: "Read Later" });
    await alice.profiles.update({ username: "alice_new" });
    await alice.profiles.update({ username: "alice_final" });
    await alice.groups.update({ id: group.id, name: "Books" });
    await alice.groups.update({ id: group.id, name: "Library" });
    for (const username of ["alice", "ALICE_NEW", "alice_final"]) {
      assert.equal(
        (await guest.routes.resolve({ path: `/u/${username}` })).canonicalPath,
        "/u/alice_final",
      );
      for (const slug of ["read-later", "books", "library"])
        assert.deepEqual(await guest.routes.resolve({ path: `/u/${username}/${slug}` }), {
          kind: "group",
          userId: "alice",
          groupId: group.id,
          canonicalPath: "/u/alice_final/library",
        });
    }
    assert.equal(
      (await guest.routes.resolve({ path: "/people/alice", group: group.id })).canonicalPath,
      "/u/alice_final/library",
    );
    assert.equal((await guest.profiles.byUsername({ username: "ALICE" })).username, "alice_final");
  });
  it("rechecks group/profile access before returning any alias or redirect", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob"),
      guest = api.client(null);
    const group = await alice.groups.create({ name: "Secret", visibility: "private" });
    await alice.groups.update({ id: group.id, name: "New Secret" });
    for (const path of ["/u/alice/secret", "/u/alice/new-secret", "/u/alice/missing"])
      await assert.rejects(bob.routes.resolve({ path }), {
        code: "NOT_FOUND",
        message: "Destination not found.",
      });
    await assert.rejects(guest.routes.resolve({ path: "/people/alice", group: group.id }), {
      code: "NOT_FOUND",
    });
    await alice.groups.update({ id: group.id, visibility: "public" });
    await alice.profiles.update({ profileVisibility: "private" });
    assert.equal((await guest.routes.resolve({ path: "/u/alice" })).kind, "profile"); // public identity only
    await assert.rejects(bob.routes.resolve({ path: "/u/alice/secret" }), { code: "NOT_FOUND" });
    await bob.follows.follow({ userId: "alice" });
    await alice.follows.accept({ userId: "bob" });
    assert.equal((await bob.routes.resolve({ path: "/u/alice/secret" })).kind, "group");
    await alice.follows.removeFollower({ userId: "bob" });
    await assert.rejects(bob.routes.resolve({ path: "/u/alice/secret" }), { code: "NOT_FOUND" });
  });
  it("keeps Starred owner-only even when its old visibility field says public", async () => {
    const alice = api.client("alice");
    const bobLink = await api.client("bob").links.create({ url: "https://example.com/starred" });
    await alice.stars.add({ linkId: bobLink.id });
    const result = await alice.routes.resolve({ path: "/u/alice/starred" });
    assert.equal(result.kind, "group");
    if (result.kind === "group") {
      assert.equal((await alice.groups.get({ id: result.groupId })).visibility, "private");
      await assert.rejects(alice.groups.update({ id: result.groupId, visibility: "public" }), {
        code: "BAD_REQUEST",
      });
    }
    if (result.kind === "group") {
      // Simulate a pre-migration public Starred row, including bypassing the application write API.
      await api.db.execute(
        sql`update groups set visibility='public' where id=${result.groupId}::uuid`,
      );
    }
    for (const viewer of [null, "bob"]) {
      await assert.rejects(api.client(viewer).routes.resolve({ path: "/u/alice/starred" }), {
        code: "NOT_FOUND",
      });
      if (result.kind === "group") {
        await assert.rejects(api.client(viewer).links.listInGroup({ groupId: result.groupId }), {
          code: "NOT_FOUND",
        });
        await assert.rejects(api.client(viewer).groups.get({ id: result.groupId }), {
          code: "NOT_FOUND",
        });
        assert.equal(
          (await alice.links.weeks({ userId: "alice", groupId: result.groupId })).items.length,
          1,
        );
        const weeks = await api
          .client(viewer)
          .links.weeks({ userId: "alice", groupId: result.groupId });
        assert.deepEqual(weeks, { items: [], nextBefore: null });
        assert.deepEqual(
          weeks,
          await api
            .client(viewer)
            .links.weeks({ userId: "alice", groupId: "00000000-0000-4000-8000-000000000001" }),
        );
        const listed = await api.client(viewer).groups.list({ ownerId: "alice" });
        assert.equal(
          listed.items.some((g) => g.id === result.groupId),
          false,
        );
        await assert.rejects(
          api.client(viewer).routes.resolve({ path: "/people/alice", group: result.groupId }),
          { code: "NOT_FOUND" },
        );
      }
    }
    await alice.routes.resolve({ path: "/u/alice/favorites" });
    assert.equal(
      (await api.client(null).routes.resolve({ path: "/u/alice/favorites" })).kind,
      "group",
    );
  });
  it("short IDs and legacy permalinks never bypass link or conversation access", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob"),
      guest = api.client(null);
    const group = await alice.groups.create({ name: "Reading" });
    const link = await alice.links.create({ url: "https://example.com", groupId: group.id });
    assert.match(link.shortId, /^[A-Za-z0-9_-]{16}$/);
    assert.equal(
      (await guest.routes.resolve({ path: `/links/${link.id}` })).canonicalPath,
      `/l/${link.shortId}`,
    );
    assert.equal((await guest.routes.resolve({ path: `/l/${link.shortId}` })).kind, "link");
    await alice.groups.update({ id: group.id, visibility: "private" });
    for (const path of [`/links/${link.id}`, `/l/${link.shortId}`])
      await assert.rejects(bob.routes.resolve({ path }), { code: "NOT_FOUND" });
    await alice.follows.follow({ userId: "bob" });
    const chat = await alice.messages.createConversation({ recipientIds: ["bob"] });
    for (const key of [chat.id, chat.shortId]) {
      assert.equal(
        (await bob.routes.resolve({ path: `/messages/${key}` })).canonicalPath,
        `/messages/${chat.shortId}`,
      );
      await assert.rejects(guest.routes.resolve({ path: `/messages/${key}` }), {
        code: "NOT_FOUND",
      });
      await assert.rejects(api.client("outsider").routes.resolve({ path: `/messages/${key}` }), {
        code: "NOT_FOUND",
      });
    }
    await assert.rejects(alice.routes.resolve({ path: "//external.example/u/alice" }), {
      code: "NOT_FOUND",
    });
    await assert.rejects(alice.routes.resolve({ path: "/u/%2Falice" }), { code: "NOT_FOUND" });
    await assert.rejects(alice.routes.resolve({ path: "/u/%" }), { code: "NOT_FOUND" });
  });
  it("retries random collisions atomically and retains short reservations after deletion", async () => {
    const alice = api.client("alice");
    await api.db.execute(sql`create sequence route_test_candidates`);
    // First two allocation attempts deliberately collide; the third succeeds.
    await api.db.execute(
      sql`create or replace function public.index_short_candidate() returns text language sql volatile as $$ select case when nextval('route_test_candidates') <= 2 then 'aaaaaaaaaaaaaaaa' else 'bbbbbbbbbbbbbbbb' end $$`,
    );
    try {
      const first = await alice.links.create({ url: "https://example.com/one" });
      const second = await alice.links.create({ url: "https://example.com/two" });
      assert.equal(first.shortId, "aaaaaaaaaaaaaaaa");
      assert.equal(second.shortId, "bbbbbbbbbbbbbbbb");
      await alice.links.delete({ id: first.id });
      await assert.rejects(alice.routes.resolve({ path: `/l/${first.shortId}` }), {
        code: "NOT_FOUND",
      });
      const reservation = await api.db.execute(
        sql`select * from short_routes where short_id=${first.shortId}`,
      );
      assert.equal(reservation.rows.length, 1);
      await assert.rejects(
        api.db.execute(
          sql`update links set short_id='cccccccccccccccc' where id=${second.id}::uuid`,
        ),
      );
      await assert.rejects(alice.links.create({ url: "https://example.com/exhausted" }), {
        code: "INTERNAL_SERVER_ERROR",
      });
      assert.equal((await alice.links.listMine({})).items.length, 1);
    } finally {
      await api.db.execute(
        sql`create or replace function public.index_short_candidate() returns text language sql volatile as $$ select translate(encode(substring(decode(replace(gen_random_uuid()::text,'-',''),'hex') from 1 for 12),'base64'), '+/', '-_') $$`,
      );
    }
  });
});
