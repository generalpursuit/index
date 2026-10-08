import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createLinkInputSchema, listMyLinksInputSchema } from "./schemas";

describe("link input validation", () => {
  it("trims pasted input and defaults the category", () => {
    assert.deepEqual(
      createLinkInputSchema.parse({
        url: " https://example.com/read ",
        title: " Read this ",
        description: " Notes ",
      }),
      {
        url: "https://example.com/read",
        title: "Read this",
        description: "Notes",
        category: "uncategorized",
      },
    );
  });

  it("accepts a manual category and an omitted or null description", () => {
    assert.equal(
      createLinkInputSchema.parse({
        url: "http://example.com",
        title: "Music",
        category: "music",
        description: null,
      }).category,
      "music",
    );
    assert.equal(
      createLinkInputSchema.parse({ url: "https://example.com", title: "Example" }).description,
      undefined,
    );
  });

  it("rejects unsafe URL schemes, blank titles, unknown categories, and oversized input", () => {
    const valid = { url: "https://example.com", title: "Example" };
    for (const input of [
      { ...valid, url: "javascript:alert(1)" },
      { ...valid, url: "file:///etc/passwd" },
      { ...valid, url: "ftp://example.com" },
      { ...valid, url: "not a URL" },
      { ...valid, title: "  " },
      { ...valid, category: "unknown" },
      { ...valid, title: "a".repeat(501) },
      { ...valid, description: "a".repeat(10_001) },
      { ...valid, url: `https://example.com/${"a".repeat(8192)}` },
      { ...valid, ownerId: "someone-else" },
      { ...valid, groupId: "00000000-0000-4000-8000-000000000001" },
    ])
      assert.equal(createLinkInputSchema.safeParse(input).success, false);
  });

  it("bounds pagination inputs", () => {
    assert.deepEqual(listMyLinksInputSchema.parse({}), { limit: 20 });
    for (const input of [
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { cursor: "" },
      { cursor: "x".repeat(513) },
    ]) {
      assert.equal(listMyLinksInputSchema.safeParse(input).success, false);
    }
  });
});
