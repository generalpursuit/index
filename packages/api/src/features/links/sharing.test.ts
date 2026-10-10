import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupApiTests } from "../../testing/api";
import { user } from "@index/db/schema/auth";
import { eq } from "drizzle-orm";

describe("atomic link sharing", () => {
  const api = setupApiTests();
  const input = () => ({ url: "https://example.test/shared", requestId: crypto.randomUUID() });
  it("saves once into the UTC current week and retries the same receipt", async () => {
    const alice = api.client("alice"),
      request = input();
    const saved = await alice.links.share(request);
    assert.equal(saved.status, "saved");
    assert.equal(saved.link.savedOn, new Date().toISOString().slice(0, 10));
    assert.deepEqual(await alice.links.share(request), saved);
    assert.equal((await alice.links.listMine({})).items.length, 1);
  });
  it("detects all owned URL duplicates, including another group/week; explicit save again is distinct and retryable", async () => {
    const alice = api.client("alice"),
      request = input();
    const group = await alice.groups.create({ name: "Reading", visibility: "private" });
    const old = await alice.links.create({ url: request.url, groupId: group.id });
    await api.postgres.exec(`UPDATE links SET saved_on='2020-01-01' WHERE id='${old.id}'`);
    const existing = await alice.links.share(request);
    assert.equal(existing.status, "existing");
    assert.equal(existing.link.id, old.id);
    const again = { ...input(), saveAgain: true };
    const saved = await alice.links.share(again);
    assert.notEqual(saved.link.id, old.id);
    assert.equal((await alice.links.share(again)).link.id, saved.link.id);
    assert.equal((await alice.links.listMine({})).items.length, 2);
  });
  it("serializes concurrent attempts and scopes receipts to the account and immutable payload", async () => {
    const alice = api.client("alice"),
      request = input();
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) => alice.links.share(i % 2 ? request : input())),
    );
    assert.equal(new Set(responses.map((response) => response.link.id)).size, 1);
    for (const changed of [{ url: "https://example.test/other" }, { saveAgain: true }]) {
      await assert.rejects(alice.links.share({ ...request, ...changed }), { code: "CONFLICT" });
    }
    assert.notEqual((await api.client("bob").links.share(request)).link.id, responses[0]!.link.id);
  });
  it("rechecks deleted, foreign and system groups on every attempt and never resurrects removed links", async () => {
    const alice = api.client("alice"),
      request = input();
    const other = await api.client("bob").groups.create({ name: "Other" });
    await assert.rejects(alice.links.share({ ...request, groupId: other.id }), {
      code: "NOT_FOUND",
    });
    const system = await alice.stars.group();
    await assert.rejects(alice.links.share({ ...request, groupId: system.id }), {
      code: "NOT_FOUND",
    });
    const group = await alice.groups.create({ name: "Owned" });
    const locked = await alice.groups.update({ id: group.id, visibility: "private" });
    const saved = await alice.links.share({ ...request, groupId: locked.id });
    await alice.groups.delete({ id: group.id, deleteLinks: false });
    await assert.rejects(alice.links.share({ ...request, groupId: locked.id }), {
      code: "NOT_FOUND",
    });
    const second = input(),
      result = await alice.links.share(second);
    await alice.links.delete({ id: result.link.id });
    await assert.rejects(alice.links.share(second), { code: "CONFLICT" });
    assert.equal((await alice.links.listMine({})).items.length, 0);
    assert.equal(saved.link.ownerId, "alice");
  });
  it("rejects unauthenticated/unverified writes, invalid URLs and extra destinations", async () => {
    const request = input();
    await assert.rejects(api.client(null).links.share(request), { code: "UNAUTHORIZED" });
    for (const url of ["file:///tmp/foo", "https://user:secret@example.test", "not a URL"]) {
      await assert.rejects(api.client("alice").links.share({ ...request, url }), {
        code: "BAD_REQUEST",
      });
    }
    await assert.rejects(
      api.client("alice").links.share({ ...request, groups: [] } as typeof request),
      { code: "BAD_REQUEST" },
    );
    await api.db.update(user).set({ emailVerified: false }).where(eq(user.id, "alice"));
    await assert.rejects(api.client("alice").links.share(request), { code: "NOT_FOUND" });
  });
});
