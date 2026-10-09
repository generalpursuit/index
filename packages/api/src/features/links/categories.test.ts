import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { categorize } from "./categories";

describe("link categories", () => {
  it("uses domain boundaries and URL paths, with an honest unknown fallback", () => {
    for (const [url, expected] of [
      ["https://open.spotify.com/episode/123", "podcast"],
      ["https://open.spotify.com/track/123", "music"],
      ["https://youtu.be/123", "video"],
      ["https://music.apple.com/album/123", "music"],
      ["https://goodreads.com/book/show/123", "book"],
      ["https://github.com/org/repo", "tool"],
      ["https://example.notion.site/abc", "note"],
      ["https://example.com/articles/read", "article"],
      ["https://author.substack.com/p/read", "article"],
      ["https://youtube.com.attacker.example/watch", "uncategorized"],
      ["https://example.com", "uncategorized"],
    ] as const) {
      assert.equal(categorize(url), expected, url);
    }
  });
});
