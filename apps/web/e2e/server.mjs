import { createTestDatabase } from "../../../packages/api/src/testing/database.ts";
import { createAuth } from "../../../packages/auth/src/index.ts";
import { createRouterClient } from "@orpc/server";
import { appRouter } from "../../../packages/api/src/routers/index.ts";
import { apiHandler, rpcHandler } from "../../server/src/transport.ts";
import { memoryMediaStore } from "../../../packages/api/src/features/profiles/media.ts";
const database = await createTestDatabase();
const auth = createAuth(
  {
    BETTER_AUTH_URL: "http://localhost:3002",
    BETTER_AUTH_SECRET: "isolated-playwright-only-secret-32-characters",
    CORS_ORIGIN: "http://localhost:4173",
  },
  database.db,
  ["tauri://localhost", "http://tauri.localhost"],
);
let fixture;
// Pages on the reserved .test domain are served from fixtures so tests never need the internet.
// Set E2E_LIVE_PAGES=1 to read real pages while clicking through the app by hand.
const fixturePages = {
  "https://pages.test/calm-software": `<html><head><title>Ignored</title>
    <meta property="og:title" content="Calm Software — Pages">
    <meta property="og:site_name" content="Pages">
    <meta property="og:type" content="video.other"></head></html>`,
  "https://pages.test/slow-read": `<html><head><title>Slow read</title></head></html>`,
};
// Takes a moment like a real site, so tests can check what happens while a page is read.
const slowPages = new Set(["https://pages.test/slow-read"]);
async function fetchPage(url, init) {
  if (slowPages.has(url)) await new Promise((resolve) => setTimeout(resolve, 1500));
  const html = fixturePages[url];
  if (html) return new Response(html, { headers: { "content-type": "text/html" } });
  if (process.env.E2E_LIVE_PAGES === "1") return fetch(url, init);
  throw new TypeError("Offline: only fixture pages are available.");
}
async function seed() {
  await database.client.exec('TRUNCATE TABLE "user", conversations CASCADE');
  const people = {};
  for (const name of ["Alice", "Bob", "Lena", "Amir", "Iris", "Mia", "Noah"]) {
    const result = await auth.api.signUpEmail({
      body: {
        name,
        username: name.toLowerCase(),
        email: name.toLowerCase() + "@test.example",
        password: "test-password-123",
      },
    });
    people[name] = result.user.id;
  }
  const api = (name) => createRouterClient(appRouter, { context: database.context(people[name]) });
  for (const name of Object.keys(people))
    await api(name).profiles.update({
      profileVisibility: ["Iris", "Mia"].includes(name) ? "private" : "public",
    });
  for (const name of ["Bob", "Lena", "Amir", "Iris"]) {
    await api("Alice").follows.follow({ userId: people[name] });
    if (name === "Iris") await api("Iris").follows.accept({ userId: people.Alice });
  }
  await api("Lena").follows.follow({ userId: people.Mia });
  await api("Mia").follows.accept({ userId: people.Lena });
  await api("Alice").profiles.update({ profileVisibility: "private" });
  await api("Mia").follows.follow({ userId: people.Alice });
  await api("Noah").follows.follow({ userId: people.Alice });
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const week = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() - 7);
  const older = d.toISOString().slice(0, 10);
  const reading = await api("Alice").groups.create({ name: "Reading" });
  const notes = await api("Alice").groups.create({ name: "Notes", visibility: "private" });
  const links = [];
  for (const [i, title] of [
    "Are.na",
    "In Rainbows",
    "Design Engineering",
    "The Shape of Design",
  ].entries())
    links.push(
      await api("Alice").links.create({
        title,
        url: [
          "https://are.na",
          "https://open.spotify.com/album/test",
          "https://designengineering.io",
          "https://shapeofdesignbook.com",
        ][i],
        groupId: reading.id,
      }),
    );
  const earlier = await api("Alice").links.create({
    title: "Earlier notes",
    url: "https://example.com/earlier",
    groupId: reading.id,
  });
  // Links are always saved today, so the fixture moves this one into last week directly.
  await database.client.query("update links set saved_on = $1 where id = $2", [older, earlier.id]);
  const locked = await api("Alice").links.create({
    title: "Working notes",
    url: "https://example.com/locked",
    groupId: notes.id,
  });
  let privateLink;
  for (const name of ["Lena", "Amir", "Iris"]) {
    const g = await api(name).groups.create({ name: "Reading" });
    for (const [i, title] of [
      "The Shape of Design",
      "Design Details",
      "Ways of Seeing",
      "A List Apart",
      "Ambient Works",
    ].entries()) {
      const link = await api(name).links.create({
        title: name + " · " + title,
        url:
          [
            "https://goodreads.com/book/show/",
            "https://open.spotify.com/episode/",
            "https://openlibrary.org/works/",
            "https://medium.com/@",
            "https://open.spotify.com/track/",
          ][i] + name.toLowerCase(),
        groupId: g.id,
      });
      if (name === "Iris" && i === 0) privateLink = link;
    }
  }
  const chat = await api("Alice").messages.createConversation({
    recipientIds: [people.Bob, people.Lena],
  });
  await api("Alice").messages.send({
    conversationId: chat.id,
    body: "A place for good finds.",
    clientId: crypto.randomUUID(),
  });
  await api("Bob").messages.send({
    conversationId: chat.id,
    body: "Adding it to my list.",
    clientId: crypto.randomUUID(),
  });
  await api("Lena").follows.follow({ userId: people.Alice });
  await api("Alice").follows.accept({ userId: people.Lena });
  await api("Lena").comments.create({
    linkId: links[0].id,
    body: "Do you have a favorite channel?",
  });
  // Set E2E_MORE_SAMPLES=1 for months of extra people and links while clicking through by hand.
  // Tests rely on the exact data above, so they never set it.
  if (process.env.E2E_MORE_SAMPLES === "1") await seedMore(people, week, reading);
  fixture = {
    people,
    week,
    older,
    links,
    privateLink,
    reading,
    notes,
    locked,
    conversationId: chat.id,
  };
  return fixture;
}
// [title, url] per category, as people would save them; the category is stored as given.
const catalog = {
  article: [
    ["Attention Is All You Need", "https://arxiv.org/abs/1706.03762"],
    ["Scaling Laws for Neural Language Models", "https://arxiv.org/abs/2001.08361"],
    ["Brutalist architecture", "https://en.wikipedia.org/wiki/Brutalist_architecture"],
    ["Bauhaus", "https://en.wikipedia.org/wiki/Bauhaus"],
    ["Wabi-sabi", "https://en.wikipedia.org/wiki/Wabi-sabi"],
    ["The case for slow software", "https://www.robinsloan.com/posts/slow-software/"],
    ["Write simply", "https://medium.com/@writingcraft/write-simply-4f1c2a9e"],
    ["The quiet web", "https://thequietweb.substack.com/p/the-quiet-web"],
    ["Notes on taste", "https://www.figma.com/blog/notes-on-taste/"],
    ["Designing calm technology", "https://www.smashingmagazine.com/articles/calm-technology/"],
    ["Typography in ten minutes", "https://practicaltypography.com/blog/ten-minutes"],
    ["A beginner's guide to fermentation", "https://www.seriouseats.com/articles/fermentation"],
    ["Small teams, big software", "https://notboring.substack.com/p/small-teams-big-software"],
    ["On repair", "https://www.noemamag.com/articles/on-repair"],
    ["Map–territory relation", "https://en.wikipedia.org/wiki/Map%E2%80%93territory_relation"],
  ],
  podcast: [
    [
      "Design Matters: Paula Scher",
      "https://podcasts.apple.com/us/podcast/design-matters/id1077224",
    ],
    ["99% Invisible: The Sound of Sport", "https://podcasts.apple.com/us/podcast/id394775318"],
    ["Hard Fork", "https://open.spotify.com/show/44fllCS2FTFr2x2kjP9xeT"],
    ["The Ezra Klein Show", "https://open.spotify.com/show/3oB5noYIwEB2dMAREj2F7S"],
    ["Huberman Lab: Master your sleep", "https://open.spotify.com/episode/6pTn2bTq3SXA0X1Zx8wLyq"],
    ["Song Exploder: Bon Iver", "https://overcast.fm/+Ab3c9xZq"],
    ["Acquired: Nintendo", "https://podcasts.apple.com/us/podcast/acquired/id1050462261"],
    ["Radiolab: Colors", "https://pocketcasts.com/podcasts/radiolab/colors"],
    ["Reply All: The Case of the Missing Hit", "https://overcast.fm/+Bz4fW8kQ"],
    ["Dithering: Calm interfaces", "https://overcast.fm/+Cd7tKf2M"],
    ["The Changelog: Local-first", "https://pocketcasts.com/podcasts/changelog/local-first"],
    ["Lex Fridman Podcast #400", "https://open.spotify.com/episode/3Vb8ZyCsk9H6dR8i2y4FvN"],
  ],
  music: [
    ["Radiohead – Kid A", "https://open.spotify.com/album/6GjwtEZcfenmOf6l18N7T7"],
    ["Frank Ocean – Blonde", "https://music.apple.com/us/album/blonde/1146195596"],
    ["Brian Eno – Music for Airports", "https://open.spotify.com/album/0bOcmGYAfQKeyoH4JiUdCn"],
    ["Nick Drake – Pink Moon", "https://open.spotify.com/album/1SnTI7mmUqWD2YPuwZKusk"],
    ["Selected Ambient Works 85–92", "https://aphextwin.bandcamp.com/album/selected-ambient-works"],
    ["Nils Frahm – Says", "https://open.spotify.com/track/3Bf3n2rAPOtMjgcqC6Dlsz"],
    ["Floating Points – Promises", "https://floatingpoints.bandcamp.com/album/promises"],
    ["Late Night Jazz", "https://open.spotify.com/playlist/37i9dQZF1DX4wta20PHgwo"],
    ["Khruangbin – María También", "https://soundcloud.com/khruangbin/maria-tambien"],
    ["Bonobo – Kerala", "https://music.apple.com/us/album/kerala/1193701079"],
    ["Hiroshi Yoshimura – Green", "https://open.spotify.com/album/6xYKJiuWp3XO4Gm5Fl0W1x"],
    ["Deep focus mix", "https://soundcloud.com/lofigirl/deep-focus-mix"],
  ],
  video: [
    ["The Art of Code – Dylan Beattie", "https://www.youtube.com/watch?v=6avJHaC3C2U"],
    ["Bret Victor – Inventing on Principle", "https://vimeo.com/36579366"],
    ["Rich Hickey – Simple Made Easy", "https://www.youtube.com/watch?v=SxdOUGdseq4"],
    ["Edgar Wright – How to Do Visual Comedy", "https://www.youtube.com/watch?v=3FOzD4Sfgag"],
    ["The Mother of All Demos", "https://www.youtube.com/watch?v=yJDv-zdhzMY"],
    ["Kurzgesagt – The Egg", "https://www.youtube.com/watch?v=h6fcK_fRYaI"],
    ["Ramen at home, start to finish", "https://www.youtube.com/watch?v=9WXIrnWsaCo"],
    ["The symmetry of Wes Anderson", "https://vimeo.com/89302848"],
    ["Paris to Berlin by night train", "https://www.youtube.com/watch?v=Rf7tKq0H1uY"],
    ["Speedrun marathon highlights", "https://www.twitch.tv/videos/1958301122"],
    ["The making of Spirited Away", "https://vimeo.com/120334829"],
    ["How a mechanical watch works", "https://www.youtube.com/watch?v=9O9ojxEbOqs"],
  ],
  book: [
    ["The Design of Everyday Things", "https://www.goodreads.com/book/show/840"],
    ["A Pattern Language", "https://www.goodreads.com/book/show/79766.A_Pattern_Language"],
    ["Thinking in Systems", "https://www.goodreads.com/book/show/3828902-thinking-in-systems"],
    ["The Left Hand of Darkness", "https://openlibrary.org/works/OL59800W"],
    ["Piranesi", "https://www.goodreads.com/book/show/50202953-piranesi"],
    ["How Buildings Learn", "https://openlibrary.org/works/OL1963280W"],
    ["Klara and the Sun", "https://www.goodreads.com/book/show/54120408-klara-and-the-sun"],
    ["Four Thousand Weeks", "https://books.google.com/books?id=pNw4EAAAQBAJ"],
    ["The Overstory", "https://www.goodreads.com/book/show/40180098-the-overstory"],
    ["Grid Systems in Graphic Design", "https://openlibrary.org/works/OL2667553W"],
    ["Tomorrow, and Tomorrow, and Tomorrow", "https://www.goodreads.com/book/show/58784475"],
    ["Crafting Interpreters", "https://books.google.com/books?id=q0c6EAAAQBAJ"],
  ],
  tool: [
    ["excalidraw/excalidraw", "https://github.com/excalidraw/excalidraw"],
    ["tldraw/tldraw", "https://github.com/tldraw/tldraw"],
    ["oven-sh/bun", "https://github.com/oven-sh/bun"],
    ["drizzle-orm", "https://www.npmjs.com/package/drizzle-orm"],
    ["electric-sql/pglite", "https://github.com/electric-sql/pglite"],
    ["httpie", "https://pypi.org/project/httpie/"],
    ["BurntSushi/ripgrep", "https://github.com/BurntSushi/ripgrep"],
    ["date-fns", "https://www.npmjs.com/package/date-fns"],
    ["inkscape/inkscape", "https://gitlab.com/inkscape/inkscape"],
    ["rich", "https://pypi.org/project/rich/"],
    ["charmbracelet/gum", "https://github.com/charmbracelet/gum"],
    ["jqlang/jq", "https://github.com/jqlang/jq"],
  ],
  note: [
    ["Trip packing list", "https://www.notion.so/Trip-packing-list-8c1f2a9e4b7d4e1f"],
    ["Reading log 2026", "https://www.notion.so/Reading-log-2026-3a7e91c0d2f84b5a"],
    ["Recipe: miso aubergine", "https://pastebin.com/Lm4xR8tQ"],
    ["Studio meeting notes", "https://studio.notion.site/Meeting-notes-1f9b2c7d"],
    ["Gift ideas", "https://www.notion.so/Gift-ideas-5d2a8e7f1c3b4a90"],
    ["Bike maintenance checklist", "https://pastebin.com/Qw7eZ3nV"],
    ["Planting calendar", "https://garden.notion.site/Planting-calendar-6b1e"],
    ["Interview questions", "https://www.notion.so/Interview-questions-9e4c1b2a7d"],
    ["Shell aliases", "https://pastebin.com/raw/Hx2kP9sD"],
    ["Weekly review template", "https://www.notion.so/Weekly-review-2c8f7a1e"],
  ],
  uncategorized: [
    ["Quiet interfaces", "https://www.are.na/channel/quiet-interfaces"],
    ["Teenage Engineering OP-1 field", "https://teenage.engineering/products/op-1"],
    ["Muji wall-mounted CD player", "https://www.muji.com/eu/products/cmdty/detail/4550002457"],
    ["Kinfolk", "https://www.kinfolk.com"],
    ["Fonts In Use: Berlin transit", "https://fontsinuse.com/uses/48213/"],
    ["Open-air cinemas in Berlin", "https://www.berlin.de/kino/freiluftkino/"],
    ["Linear Method", "https://linear.app/method"],
    ["kottke.org", "https://kottke.org"],
    ["Ask HN: What are you reading?", "https://news.ycombinator.com/item?id=41234567"],
    ["Cabin in the Black Forest", "https://www.airbnb.com/rooms/48291037"],
    ["Standard Ebooks", "https://standardebooks.org"],
    ["Ceramics studio Kreuzberg", "https://www.keramik-kreuzberg.de"],
  ],
};
const samples = Object.entries(catalog).flatMap(([category, items]) =>
  items.map(([title, url]) => ({ title, url, category })),
);
// [username, name, visibility, weeks of history, people they follow]; alice follows the first eight.
const samplePeople = [
  [
    "sofia_marques",
    "Sofia Marques",
    "public",
    28,
    "alice kwatanabe theolindqvist elena_p nora_lind",
  ],
  ["kwatanabe", "Kenji Watanabe", "public", 26, "alice theolindqvist elena_p omar_h"],
  ["priya_r", "Priya Raman", "private", 24, "alice ruth_abebe"],
  ["theolindqvist", "Theo Lindqvist", "public", 28, "alice sofia_marques elena_p ruth_abebe"],
  ["hannah_okafor", "Hannah Okafor", "public", 20, "mateorossi felixhartmann"],
  ["mateorossi", "Mateo Rossi", "public", 22, "yusuf_demir felixhartmann ruth_abebe"],
  ["clara_b", "Clara Becker", "private", 18, "priya_r nora_lind"],
  ["yusuf_demir", "Yusuf Demir", "public", 25, "hannah_okafor nora_lind"],
  ["elena_p", "Elena Petrova", "public", 12, "sofia_marques"],
  ["felixhartmann", "Felix Hartmann", "public", 8, ""],
  ["nora_lind", "Nora Lind", "private", 10, ""],
  ["omar_h", "Omar Haddad", "public", 6, ""],
  ["ruth_abebe", "Ruth Abebe", "public", 9, "theolindqvist"],
];
// Nobody saved anything in these weeks, so the feed has to skip past them.
const quietWeeks = new Set([4, 11, 12, 19]);
// Groups by category; Alice keeps some of hers locked.
const aliceGroups = {
  book: "Reading",
  music: "Listening",
  podcast: "Listening",
  video: "Watch later",
};
const lockedGroups = { article: "Research", note: "Someday" };
const sampleGroups = { book: "Reading", article: "Reading", music: "Listening", video: "Watching" };
async function seedMore(people, week, reading) {
  // Fixed seed, so every reset makes the same data relative to this week.
  let state = 7;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (low, high) => low + Math.floor(random() * (high - low + 1));
  const ids = Object.fromEntries(Object.entries(people).map(([n, id]) => [n.toLowerCase(), id]));
  const hidden = new Set(["alice", "iris", "mia"]);
  for (const [username, name, visibility] of samplePeople) {
    const result = await auth.api.signUpEmail({
      body: { name, username, email: username + "@test.example", password: "test-password-123" },
    });
    ids[username] = result.user.id;
    if (visibility === "private") hidden.add(username);
  }
  const api = (username) =>
    createRouterClient(appRouter, { context: database.context(ids[username]) });
  for (const [username, , profileVisibility] of samplePeople)
    await api(username).profiles.update({ profileVisibility });
  const follow = async (from, to) => {
    await api(from).follows.follow({ userId: ids[to] });
    if (hidden.has(to)) await api(to).follows.accept({ userId: ids[from] });
  };
  const followed = samplePeople.slice(0, 8).map(([username]) => username);
  for (const username of followed) await follow("alice", username);
  for (const [username, , , , follows] of samplePeople)
    for (const to of follows.split(" ").filter(Boolean)) await follow(username, to);
  await follow("lena", "sofia_marques");
  await follow("lena", "elena_p");
  // Everyone saves from a shuffled deck, so a week never repeats a link.
  const authors = [
    ["alice", 28],
    ["lena", 20],
    ["amir", 16],
    ["iris", 14],
    ["bob", 10],
    ...samplePeople.map(([username, , , weeks]) => [username, weeks]),
  ];
  const alice = { ...aliceGroups, ...lockedGroups };
  const newcomers = new Set(samplePeople.map(([username]) => username));
  const monday = new Date(week + "T00:00:00Z").getTime();
  const now = Date.now();
  const today = now - (now % 86_400_000);
  const rows = [];
  for (const [username, weeks] of authors) {
    const groups = username === "alice" ? { Reading: reading } : {};
    const groupFor = async (category) => {
      const name = (username === "alice" ? alice : newcomers.has(username) ? sampleGroups : {})[
        category
      ];
      if (!name) return null;
      groups[name] ??= await api(username).groups.create({
        name,
        visibility: Object.values(lockedGroups).includes(name) ? "private" : "public",
      });
      return groups[name].id;
    };
    const deck = [...samples];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = pick(0, i);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    let next = 0;
    for (let back = 0; back < weeks; back++) {
      if (quietWeeks.has(back) || random() < 0.25) continue;
      const roll = random();
      const count = roll < 0.4 ? pick(1, 2) : roll < 0.75 ? pick(3, 7) : pick(8, 25);
      for (let n = 0; n < count; n++) {
        const sample = deck[next++ % deck.length];
        const day = Math.min(monday + (pick(0, 6) - back * 7) * 86_400_000, today);
        const time = Math.min(day + pick(7 * 60, 22 * 60) * 60_000, now - n * 60_000);
        rows.push({
          owner_id: ids[username],
          group_id: random() < 0.7 ? await groupFor(sample.category) : null,
          url: sample.url,
          title: sample.title,
          category: sample.category,
          saved_on: new Date(day).toISOString().slice(0, 10),
          created_at: new Date(Math.max(time, day)).toISOString(),
        });
      }
    }
  }
  const { rows: saved } = await database.client.query(
    `insert into links (owner_id, group_id, url, title, category, saved_on, created_at)
     select * from jsonb_to_recordset($1::jsonb) as x(owner_id text, group_id uuid, url text,
       title text, category text, saved_on date, created_at timestamptz)
     returning id, owner_id, group_id`,
    [JSON.stringify(rows)],
  );
  // Alice favorites some of her own links and stars visible ones from people she follows.
  const following = new Set(["lena", "amir", "iris", "bob", ...followed].map((u) => ids[u]));
  const locked = new Set(
    (await database.client.query("select id from groups where visibility = 'private'")).rows.map(
      (g) => g.id,
    ),
  );
  for (const link of saved) {
    if (link.owner_id === ids.alice && random() < 0.12)
      await api("alice").favorites.add({ linkId: link.id });
    else if (following.has(link.owner_id) && !locked.has(link.group_id) && random() < 0.06)
      await api("alice").stars.add({ linkId: link.id });
  }
}
await seed();
// Uploaded photos stay in memory, served at `/media/*` like the bucket on the real server.
const media = memoryMediaStore("http://localhost:3002");
Bun.serve({
  hostname: "127.0.0.1",
  port: 3002,
  async fetch(request) {
    const url = new URL(request.url);
    let response;
    if (request.method === "OPTIONS") response = new Response(null, { status: 204 });
    else if (url.pathname === "/_test/reset" && request.method === "POST")
      response = Response.json(await seed());
    else if (url.pathname === "/_test/fixture") response = Response.json(fixture);
    else if (url.pathname === "/health") response = new Response("ready");
    else if (url.pathname.startsWith("/media/")) {
      const object = media.get(url.pathname.slice("/media/".length));
      response = object
        ? new Response(object.body, {
            headers: {
              "content-type": object.contentType,
              "cache-control": "public, max-age=31536000, immutable",
            },
          })
        : new Response("Not found", { status: 404 });
    } else if (url.pathname.startsWith("/api/auth/")) response = await auth.handler(request);
    else {
      const session = await auth.api.getSession({ headers: request.headers });
      const result = await rpcHandler.handle(request, {
        prefix: "/rpc/v1",
        context: { db: database.db, session, fetchPage, media },
      });
      const rest = result.matched
        ? result
        : await apiHandler.handle(request, {
            prefix: "/api/v1",
            context: { db: database.db, session, fetchPage, media },
          });
      response = rest.response ?? new Response("Not found", { status: 404 });
    }
    const headers = new Headers(response.headers);
    const origin = request.headers.get("origin");
    if (["http://localhost:4173", "tauri://localhost", "http://tauri.localhost"].includes(origin))
      headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Expose-Headers", "set-auth-token");
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
    headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    return new Response(response.body, { status: response.status, headers });
  },
});
console.log("Isolated browser-test API ready on http://localhost:3002");
