import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setupApiTests } from "../../testing/api";

describe("link search", () => {
  const api = setupApiTests();
  const titles = (page: { items: { title: string }[] }) => page.items.map((link) => link.title);

  it("matches every word in the title, address or note, ignoring case and inside words", async () => {
    const alice = api.client("alice");
    await alice.links.create({ url: "https://example.com/a", title: "Async Rust in depth" });
    await alice.links.create({ url: "https://rustacean.example/b", title: "Station" });
    await alice.links.create({
      url: "https://example.com/c",
      title: "Notes",
      description: "Why RUST closures capture",
    });
    await alice.links.create({ url: "https://example.com/100%25", title: "Discount 100%" });
    await api.client("bob").links.create({ url: "https://example.com/d", title: "Bob's Rust" });

    // Links saved together may share a timestamp, so order is checked by the paging test.
    const search = (query: string) =>
      alice.links.search({ query }).then((page) => titles(page).sort());
    assert.deepEqual(await search("rust"), ["Async Rust in depth", "Notes", "Station"]);
    assert.deepEqual(await search("  ASYNC   dep "), ["Async Rust in depth"]);
    assert.deepEqual(await search("rust closure"), ["Notes"]);
    assert.deepEqual(await search("rustacean"), ["Station"]);
    assert.deepEqual(await search("rust station"), ["Station"]);
    // Pattern characters are matched literally.
    assert.deepEqual(await search("%"), ["Discount 100%"]);
    assert.deepEqual(await search("_"), []);
    await assert.rejects(api.client(null).links.search({ query: "rust" }), {
      code: "UNAUTHORIZED",
    });
  });

  it("searches another person's links as their list shows them, before paginating", async () => {
    const alice = api.client("alice"),
      bob = api.client("bob");
    for (const n of [1, 2])
      await bob.links.create({ url: "https://example.com", title: `Open ${n}` });
    const locked = await bob.groups.create({ name: "Locked", visibility: "private" });
    for (const n of [1, 2, 3])
      await bob.links.create({
        url: "https://example.com",
        title: `Locked ${n}`,
        groupId: locked.id,
      });
    await bob.profiles.update({ profileVisibility: "private" });

    const search = (limit?: number) =>
      alice.links.search({ query: "example", userId: "bob", limit });
    assert.deepEqual(await search(), { items: [], nextCursor: null });
    assert.deepEqual(await alice.links.search({ query: "example" }), {
      items: [],
      nextCursor: null,
    });

    await alice.follows.follow({ userId: "bob" });
    assert.deepEqual((await search()).items, []);
    await bob.follows.accept({ userId: "alice" });
    // The newer locked links never fill the page or leave a cursor behind.
    const page = await search(2);
    assert.deepEqual(titles(page).sort(), ["Open 1", "Open 2"]);
    assert.equal(page.nextCursor, null);
    assert.deepEqual(
      (await alice.links.listByOwner({ userId: "bob" })).items,
      (await search()).items,
    );
    assert.equal((await bob.links.search({ query: "example" })).items.length, 5);
  });

  it("pages newest first with an opaque cursor", async () => {
    const alice = api.client("alice");
    for (const n of [1, 2, 3, 4, 5])
      await alice.links.create({ url: `https://example.com/${n}`, title: `Match ${n}` });
    await alice.links.create({ url: "https://example.com/other", title: "Other" });

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await alice.links.search({ query: "match", limit: 2, cursor });
      assert.ok(page.items.length <= 2);
      seen.push(...titles(page));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    const newestFirst = titles(await alice.links.listMine({})).filter((title) => title !== "Other");
    assert.deepEqual(seen, newestFirst);
    assert.equal(seen.length, 5);
    await assert.rejects(alice.links.search({ query: "match", cursor: "not-a-cursor" }), {
      code: "BAD_REQUEST",
    });
  });
});
