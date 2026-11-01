import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyParts } from "../src/features/messages/body-links";

/** The links of a body, as written and as opened. */
const links = (body: string) =>
  bodyParts(body)
    .filter((part) => part.href)
    .map((part) => [part.text, part.href]);

test("splits a body into text and links that together are the body", () => {
  const body = "Look: https://a.com/x and\nwww.b.org/y?z=1#top, then http://c.net.";
  assert.deepEqual(bodyParts(body), [
    { text: "Look: " },
    { text: "https://a.com/x", href: "https://a.com/x" },
    { text: " and\n" },
    { text: "www.b.org/y?z=1#top", href: "https://www.b.org/y?z=1#top" },
    { text: ", then " },
    { text: "http://c.net", href: "http://c.net" },
    { text: "." },
  ]);
  assert.equal(
    bodyParts(body)
      .map((part) => part.text)
      .join(""),
    body,
  );
  assert.deepEqual(bodyParts(""), []);
  assert.deepEqual(bodyParts("no links here"), [{ text: "no links here" }]);
  assert.deepEqual(bodyParts("https://a.com"), [{ text: "https://a.com", href: "https://a.com" }]);
});

test("leaves trailing punctuation out of a link", () => {
  for (const mark of [".", ",", ";", ":", "!", "?", "'", '"'])
    assert.deepEqual(links(`see https://a.com/x${mark}`), [["https://a.com/x", "https://a.com/x"]]);
  assert.deepEqual(links('"https://a.com/x?y=1"...'), [
    ["https://a.com/x?y=1", "https://a.com/x?y=1"],
  ]);
  // Punctuation inside a link is part of it.
  assert.deepEqual(links("https://a.com/a.b,c;d:e!f?g'h"), [
    ["https://a.com/a.b,c;d:e!f?g'h", "https://a.com/a.b,c;d:e!f?g'h"],
  ]);
});

test("keeps balanced closing brackets and leaves unbalanced ones out", () => {
  assert.deepEqual(links("https://en.wikipedia.org/wiki/Foo_(bar)"), [
    ["https://en.wikipedia.org/wiki/Foo_(bar)", "https://en.wikipedia.org/wiki/Foo_(bar)"],
  ]);
  assert.deepEqual(links("(see https://a.com)"), [["https://a.com", "https://a.com"]]);
  assert.deepEqual(links("(see https://a.com/x_(y))."), [
    ["https://a.com/x_(y)", "https://a.com/x_(y)"],
  ]);
  assert.deepEqual(links("[https://a.com/[1]]"), [["https://a.com/[1]", "https://a.com/[1]"]]);
  assert.deepEqual(links("{https://a.com/{x}}!"), [["https://a.com/{x}", "https://a.com/{x}"]]);
  // Punctuation and brackets interleaved at the end.
  assert.deepEqual(links("(https://a.com/x?)."), [["https://a.com/x", "https://a.com/x"]]);
  // A bracket opened elsewhere doesn't balance one of another kind.
  assert.deepEqual(links("https://a.com/(x]"), [["https://a.com/(x", "https://a.com/(x"]]);
});

test("leaves out surrounding angle brackets", () => {
  assert.deepEqual(bodyParts("<https://a.com/x>"), [
    { text: "<" },
    { text: "https://a.com/x", href: "https://a.com/x" },
    { text: ">" },
  ]);
  assert.deepEqual(links("<www.a.com>."), [["www.a.com", "https://www.a.com"]]);
});

test("accepts any case of the scheme and www, keeping the text as written", () => {
  assert.deepEqual(links("HTTPS://A.COM/Path HtTp://b.com WWW.C.COM"), [
    ["HTTPS://A.COM/Path", "HTTPS://A.COM/Path"],
    ["HtTp://b.com", "HtTp://b.com"],
    ["WWW.C.COM", "https://WWW.C.COM"],
  ]);
});

test("links only http, https and www, never other schemes or bare domains", () => {
  for (const body of [
    "javascript:alert(1)",
    "JavaScript://comment%0aalert(1)",
    "data:text/html,<b>x</b>",
    "file:///etc/passwd",
    "mailto:a@b.com",
    "ftp://a.com",
    "example.com",
    "a.com/path",
    "https://",
    "http:// a.com",
    "www.",
    "https://)",
    "https://[nope",
    // The browser would take a host from the path; the text itself must name one.
    "https:///path",
    "https://\\a.com",
  ])
    assert.deepEqual(links(body), [], body);
  // A web address inside another scheme still isn't linked from the middle of a word.
  assert.deepEqual(links("xhttps://a.com awww.b.com a@www.c.com a.www.d.com"), []);
  assert.deepEqual(links("x:https://a.com"), [["https://a.com", "https://a.com"]]);
});

test("links next to other text, lines and unicode", () => {
  assert.deepEqual(bodyParts("line one\nhttps://a.com\nline three"), [
    { text: "line one\n" },
    { text: "https://a.com", href: "https://a.com" },
    { text: "\nline three" },
  ]);
  assert.deepEqual(links("見てhttps://a.com 🎉https://b.com/ü ok"), [
    ["https://a.com", "https://a.com"],
    ["https://b.com/ü", "https://b.com/ü"],
  ]);
  // Only whitespace ends a link.
  assert.deepEqual(links("https://ja.wikipedia.org/wiki/日本。次"), [
    ["https://ja.wikipedia.org/wiki/日本。次", "https://ja.wikipedia.org/wiki/日本。次"],
  ]);
});

test("handles very long bodies in linear time", () => {
  const started = performance.now();
  const long = "https://a.com/" + "x".repeat(200_000);
  assert.deepEqual(links(long), [[long, long]]);
  const closers = "https://a.com/" + ")".repeat(200_000) + ".".repeat(200_000);
  assert.deepEqual(links(closers), [["https://a.com/", "https://a.com/"]]);
  const many = "https://a.com/ www. ".repeat(20_000);
  assert.equal(links(many).length, 20_000);
  assert.equal(
    bodyParts("w".repeat(100_000) + " " + "www.".repeat(50_000))
      .map((part) => part.text)
      .join("").length,
    100_001 + 200_000,
  );
  assert.ok(performance.now() - started < 2000);
});
