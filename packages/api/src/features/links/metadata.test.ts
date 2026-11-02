import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readLinkMetadata, type FetchPage } from "./metadata";

const html = (head: string, body = "") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const page = (body: string, init: ResponseInit = {}) =>
  new Response(body, { headers: { "content-type": "text/html; charset=utf-8" }, ...init });
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const youtubeOEmbed = (url: string) =>
  `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
const xOEmbed = (url: string) =>
  `https://publish.x.com/oembed?url=${encodeURIComponent(url)}&omit_script=1`;
/** An X oEmbed answer as X writes it: the post's paragraph, then its author and date. */
const xPost = (paragraph: string) => ({
  author_name: "jack",
  author_url: "https://x.com/jack",
  html: `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">${paragraph}</p>&mdash; jack (@jack) <a href="https://x.com/jack/status/20?ref_src=twsrc%5Etfw">March 21, 2006</a></blockquote>\n`,
});

/** Serves fixed responses by URL and records every request; anything else is offline. */
function web(responses: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetchPage: FetchPage = async (url) => {
    calls.push(url);
    const respond = responses[url];
    if (!respond) throw new TypeError("offline");
    return respond();
  };
  return { fetchPage, calls };
}

describe("link metadata", () => {
  it("prefers the social title, trims a matching site name and decodes entities", async () => {
    const { fetchPage } = web({
      "https://news.example/story": () =>
        page(
          html(`<title>Ignored</title>
            <meta property="og:site_name" content="The Paper">
            <meta property="og:title" content="Rivers &amp; Roads — The Paper">
            <meta property="og:type" content="article">`),
        ),
    });
    assert.deepEqual(await readLinkMetadata("https://news.example/story", fetchPage), {
      title: "Rivers & Roads",
      category: "article",
    });
  });

  it("trims the site's own name from either end, by site name or domain", async () => {
    const { fetchPage } = web({
      "https://github.com/oven-sh/bun": () =>
        page(
          html(`<meta property="og:site_name" content="GitHub">
            <meta property="og:title" content="GitHub - oven-sh/bun: Fast JavaScript all in one">`),
        ),
      "https://en.wikipedia.org/wiki/Index_card": () =>
        page(html(`<title>Index card - Wikipedia</title>`)),
      "https://music.example/x": () => page(html(`<title>Rick Astley - Never Gonna</title>`)),
    });
    assert.equal(
      (await readLinkMetadata("https://github.com/oven-sh/bun", fetchPage)).title,
      "oven-sh/bun: Fast JavaScript all in one",
    );
    assert.equal(
      (await readLinkMetadata("https://en.wikipedia.org/wiki/Index_card", fetchPage)).title,
      "Index card",
    );
    // A dash inside a title is not a site name.
    assert.equal(
      (await readLinkMetadata("https://music.example/x", fetchPage)).title,
      "Rick Astley - Never Gonna",
    );
  });

  it("falls back to structured data, then the head title, ignoring titles in the body", async () => {
    const { fetchPage } = web({
      "https://pod.example/4": () =>
        page(
          html(`<script type="application/ld+json">
            {"@graph": [{"@type": "WebSite", "name": "Pods"},
                        {"@type": ["Thing", "PodcastEpisode"], "name": "Episode 4"}]}
          </script>`),
        ),
      "https://plain.example/": () =>
        page(html(`<title>  A plain\n page </title>`, `<svg><title>icon</title></svg>`)),
    });
    assert.deepEqual(await readLinkMetadata("https://pod.example/4", fetchPage), {
      title: "Episode 4",
      category: "podcast",
    });
    assert.equal(
      (await readLinkMetadata("https://plain.example/", fetchPage)).title,
      "A plain page",
    );
  });

  it("lets precise URL rules win over what a page declares", async () => {
    const { fetchPage } = web({
      "https://open.spotify.com/episode/1": () =>
        page(html(`<meta property="og:type" content="music.song"><title>Ep</title>`)),
    });
    assert.equal(
      (await readLinkMetadata("https://open.spotify.com/episode/1", fetchPage)).category,
      "podcast",
    );
  });

  it("categorizes files by content type and titles them from the URL", async () => {
    const { fetchPage } = web({
      "https://files.example/audio/morning-mix.mp3": () =>
        new Response("ID3", { headers: { "content-type": "audio/mpeg" } }),
    });
    assert.deepEqual(
      await readLinkMetadata("https://files.example/audio/morning-mix.mp3", fetchPage),
      { title: "Morning mix", category: "music" },
    );
  });

  it("never fails: unreachable or missing pages fall back to the URL", async () => {
    const { fetchPage } = web({
      "https://gone.example/missing-page": () => page("Not found", { status: 404 }),
    });
    assert.deepEqual(await readLinkMetadata("https://example.org/", fetchPage), {
      title: "example.org",
      category: "uncategorized",
    });
    assert.equal(
      (await readLinkMetadata("https://gone.example/missing-page", fetchPage)).title,
      "Missing page",
    );
    // Only readable slugs become titles; IDs and single words fall back to the site.
    for (const url of ["https://www.amazon.com/dp/B0BSHF7WHW", "https://www.example.com/watch?v=1"])
      assert.equal((await readLinkMetadata(url, fetchPage)).title, new URL(url).hostname.slice(4));
    assert.equal(
      (await readLinkMetadata("https://www.youtube.com/watch?v=1", fetchPage)).category,
      "video",
    );
  });

  it("never requests local or private hosts, including through redirects", async () => {
    const { fetchPage, calls } = web({
      "https://short.example/a": () => redirect("http://127.0.0.1/admin"),
      "https://short.example/b": () => redirect("/final"),
      "https://short.example/final": () => page(html("<title>Arrived</title>")),
      "https://loop.example/": () => redirect("https://loop.example/"),
    });
    for (const url of [
      "http://localhost:3002/",
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "https://printer.local/",
      "https://metadata.google.internal/",
      "https://example.com:8080/",
    ])
      await readLinkMetadata(url, fetchPage);
    assert.deepEqual(calls, []);
    assert.equal(
      (await readLinkMetadata("https://short.example/a", fetchPage)).title,
      "short.example",
    );
    assert.deepEqual(calls, ["https://short.example/a"]);
    assert.equal((await readLinkMetadata("https://short.example/b", fetchPage)).title, "Arrived");
    assert.equal(
      (await readLinkMetadata("https://loop.example/", fetchPage)).title,
      "loop.example",
    );
  });

  it("titles YouTube videos from oEmbed without reading their page", async () => {
    const watch = "https://www.youtube.com/watch?v=tpIctyqH29Q&t=30";
    const short = "https://youtu.be/tpIctyqH29Q";
    const { fetchPage, calls } = web({
      [youtubeOEmbed(watch)]: () => json({ title: "Early Computing: Crash Course #1" }),
      [youtubeOEmbed(short)]: () => json({ title: "Early  Computing\n" }),
    });
    assert.deepEqual(await readLinkMetadata(watch, fetchPage), {
      title: "Early Computing: Crash Course #1",
      category: "video",
    });
    assert.equal((await readLinkMetadata(short, fetchPage)).title, "Early Computing");
    assert.deepEqual(calls, [youtubeOEmbed(watch), youtubeOEmbed(short)]);
  });

  it("reads the page as before when oEmbed fails or does not know the link", async () => {
    const failing = "https://www.youtube.com/watch?v=gone";
    const live = "https://www.youtube.com/live/stream";
    const channel = "https://www.youtube.com/@crashcourse";
    const { fetchPage, calls } = web({
      [youtubeOEmbed(failing)]: () => page("Not Found", { status: 404 }),
      [failing]: () => page(html(`<meta property="og:title" content="From the page">`)),
      // A stream that is live answers without a title; its page is unreachable here.
      [youtubeOEmbed(live)]: () => json({ type: "video" }),
      [channel]: () => page(html(`<title>CrashCourse - YouTube</title>`)),
    });
    assert.equal((await readLinkMetadata(failing, fetchPage)).title, "From the page");
    assert.deepEqual(await readLinkMetadata(live, fetchPage), {
      title: "youtube.com",
      category: "video",
    });
    assert.equal((await readLinkMetadata(channel, fetchPage)).title, "CrashCourse");
    assert.deepEqual(calls, [youtubeOEmbed(failing), failing, youtubeOEmbed(live), live, channel]);
  });

  it("titles X posts with their author and text, without links or media", async () => {
    const { fetchPage, calls } = web({
      [xOEmbed("https://x.com/jack/status/20")]: () =>
        json(
          xPost(
            `just setting up my <a href="https://x.com/hashtag/twttr?src=hash">#twttr</a> &amp; more<br><br>see <a href="https://t.co/abc">example.com/a-long-read…</a> <a href="https://t.co/xyz">pic.x.com/xyz</a>`,
          ),
        ),
      [xOEmbed("https://x.com/jack/status/21")]: () =>
        json(xPost(`<a href="https://t.co/xyz">pic.twitter.com/xyz</a>`)),
    });
    assert.deepEqual(await readLinkMetadata("https://x.com/jack/status/20", fetchPage), {
      title: "jack: just setting up my #twttr & more see",
      category: "article",
    });
    // Only media: named the way X names it.
    assert.equal(
      (await readLinkMetadata("https://x.com/jack/status/21", fetchPage)).title,
      "jack (@jack) on X",
    );
    assert.deepEqual(calls, [
      xOEmbed("https://x.com/jack/status/20"),
      xOEmbed("https://x.com/jack/status/21"),
    ]);
  });

  it("shortens long posts at a word and asks for twitter.com posts at x.com", async () => {
    const long = `${"word ".repeat(60)}end`;
    const { fetchPage, calls } = web({
      [xOEmbed("https://x.com/jack/status/22")]: () => json(xPost(long)),
      [xOEmbed("https://x.com/jack/status/20")]: () => json(xPost("just setting up my twttr")),
      "https://x.com/jack": () =>
        page(html(`<meta property="og:title" content="jack (@jack) / X">`)),
    });
    const { title } = await readLinkMetadata("https://x.com/jack/status/22", fetchPage);
    assert.equal(title, `jack: ${"word ".repeat(39)}word…`);
    for (const url of [
      "https://twitter.com/jack/status/20",
      "https://mobile.twitter.com/jack/status/20/photo/1?s=46",
    ])
      assert.equal(
        (await readLinkMetadata(url, fetchPage)).title,
        "jack: just setting up my twttr",
      );
    // Profiles are not posts, so their page is read as before.
    assert.deepEqual(await readLinkMetadata("https://x.com/jack", fetchPage), {
      title: "jack (@jack) / X",
      category: "uncategorized",
    });
    assert.equal(calls.at(-1), "https://x.com/jack");
  });

  it("asks YouTube about a watch link with a trailing slash as it knows it", async () => {
    const watch = "https://www.youtube.com/watch?v=tpIctyqH29Q";
    const { fetchPage, calls } = web({
      [youtubeOEmbed(watch)]: () => json({ title: "Crash Course Preview" }),
    });
    assert.equal(
      (await readLinkMetadata("https://www.youtube.com/watch/?v=tpIctyqH29Q", fetchPage)).title,
      "Crash Course Preview",
    );
    assert.deepEqual(calls, [youtubeOEmbed(watch)]);
  });

  it("finds X posts by their whole ID, also from links that name no author", async () => {
    const { fetchPage, calls } = web({
      [xOEmbed("https://x.com/i/status/20")]: () => json(xPost("just setting up my twttr")),
      "https://x.com/jack/status/20garbage": () => page("Not found", { status: 404 }),
    });
    assert.deepEqual(await readLinkMetadata("https://x.com/i/web/status/20", fetchPage), {
      title: "jack: just setting up my twttr",
      category: "article",
    });
    // A mistyped ID is not read as the post it starts with.
    assert.deepEqual(await readLinkMetadata("https://x.com/jack/status/20garbage", fetchPage), {
      title: "x.com",
      category: "uncategorized",
    });
    assert.deepEqual(calls, [
      xOEmbed("https://x.com/i/status/20"),
      "https://x.com/jack/status/20garbage",
    ]);
  });

  it("keeps a title within its limit without splitting a character", async () => {
    const author = `${"😀".repeat(49)}A`;
    const { fetchPage } = web({
      [xOEmbed("https://x.com/jack/status/23")]: () =>
        json({ ...xPost("😀".repeat(201)), author_name: author }),
    });
    assert.equal(
      (await readLinkMetadata("https://x.com/jack/status/23", fetchPage)).title,
      `${author}: ${"😀".repeat(199)}`,
    );
  });

  it("reads deep heads but stops at a limit", async () => {
    const { fetchPage } = web({
      // Video sites put their tags behind about 800 KB of inline scripts.
      "https://deep.example/clip": () =>
        page(html(`<script>${"x".repeat(800_000)}</script><title>Deep title</title>`)),
      "https://huge.example/long-read": () =>
        page(
          html(`<meta name="filler" content="${"a".repeat(1_600_000)}"><title>Too late</title>`),
        ),
    });
    assert.equal(
      (await readLinkMetadata("https://deep.example/clip", fetchPage)).title,
      "Deep title",
    );
    assert.equal(
      (await readLinkMetadata("https://huge.example/long-read", fetchPage)).title,
      "Long read",
    );
  });
});
