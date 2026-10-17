import { createRouterClient } from "@orpc/server";
import { appRouter } from "../../../packages/api/src/routers/index.ts";
import type { AppRouterClient } from "../../../packages/api/src/contracts.ts";
import type { createTestDatabase } from "../../../packages/api/src/testing/database.ts";

type Database = Awaited<ReturnType<typeof createTestDatabase>>;
type Group = Awaited<ReturnType<AppRouterClient["groups"]["create"]>>;
type Person = "Alice" | "Bob" | "Lena" | "Amir" | "Iris" | "Mia" | "Noah";
export type Registration = {
  body: { name: string; username: string; email: string; password: string };
};
type RegisterFixture = (input: Registration) => Promise<{ user: { id: string } }>;

// Pages on the reserved .test domain are served from fixtures so tests never need the internet.
// Set E2E_LIVE_PAGES=1 to read real pages while clicking through the app by hand.
const fixturePages: Record<string, string> = {
  "https://pages.test/calm-software": `<html><head><title>Ignored</title>
    <meta property="og:title" content="Calm Software — Pages">
    <meta property="og:site_name" content="Pages">
    <meta property="og:type" content="video.other"></head></html>`,
  "https://pages.test/slow-read": `<html><head><title>Slow read</title></head></html>`,
};
// Takes a moment like a real site, so tests can check what happens while a page is read.
const slowPages = new Set(["https://pages.test/slow-read"]);
export async function fetchPage(url: string, init?: RequestInit) {
  if (slowPages.has(url)) await new Promise((resolve) => setTimeout(resolve, 1500));
  const html = fixturePages[url];
  if (html) return new Response(html, { headers: { "content-type": "text/html" } });
  if (process.env.E2E_LIVE_PAGES === "1") return fetch(url, init);
  throw new TypeError("Offline: only fixture pages are available.");
}
// curatee answers from fixtures too: only the profile "mara" exists, with two links saved in
// January. E2E_LIVE_PAGES=1 imports real profiles instead.
const curateeProfile = "6d7f1f0e-3a52-4c1e-9b8a-2f4e5d6c7b80";
const curateeLinks = [
  {
    id: "6d7f1f0e-3a52-4c1e-9b8a-000000000001",
    url: "https://pages.test/slow-productivity",
    title: "Slow Productivity",
    category: "book",
    body: "Lent to Mia",
    created_at: "2026-01-07T21:30:00+00:00",
  },
  {
    id: "6d7f1f0e-3a52-4c1e-9b8a-000000000002",
    url: "https://pages.test/a-talk",
    title: "A talk worth watching",
    category: "video",
    body: null,
    created_at: "2026-01-14T09:00:00+00:00",
  },
];
export async function fetchImport(url: string, init?: RequestInit) {
  if (process.env.E2E_LIVE_PAGES === "1") return fetch(url, init);
  const { pathname, searchParams } = new URL(url);
  if (pathname.endsWith("/profiles"))
    return Response.json(
      searchParams.get("username") === "eq.mara" ? [{ id: curateeProfile }] : [],
    );
  return Response.json(searchParams.get("offset") === "0" ? curateeLinks : []);
}
export async function seedFixture(database: Database, registerFixture: RegisterFixture) {
  await database.client.exec(
    'TRUNCATE TABLE "user", auth_challenge, auth_throttle, conversations, short_routes CASCADE',
  );
  const people = { Alice: "", Bob: "", Lena: "", Amir: "", Iris: "", Mia: "", Noah: "" };
  for (const name of Object.keys(people) as Person[]) {
    const result = await registerFixture({
      body: {
        name,
        username: name.toLowerCase(),
        email: name.toLowerCase() + "@test.example",
        password: "test-password-123",
      },
    });
    people[name] = result.user.id;
  }
  const api = (name: Person) =>
    createRouterClient(appRouter, { context: database.context(people[name]) });
  for (const name of Object.keys(people) as Person[])
    await api(name).profiles.update({
      profileVisibility: ["Iris", "Mia"].includes(name) ? "private" : "public",
    });
  for (const name of ["Bob", "Lena", "Amir", "Iris"] as const) {
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
        ][i]!,
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
  for (const name of ["Lena", "Amir", "Iris"] as const) {
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
  await api("Lena").messages.send({
    conversationId: chat.id,
    body: "Same here.",
    clientId: crypto.randomUUID(),
  });
  // A 1:1 chat spanning two days, which Bob has read up to Alice's latest message.
  const direct = await api("Alice").messages.createConversation({ recipientIds: [people.Bob] });
  const directMessages = [];
  for (const [sender, body] of [
    ["Alice", "Did you see the new Are.na update?"],
    ["Bob", "Not yet. Send it over?"],
    ["Alice", "Tonight, promise."],
  ] as const)
    directMessages.push(
      await api(sender).messages.send({
        conversationId: direct.id,
        body,
        clientId: crypto.randomUUID(),
      }),
    );
  await database.client.query(
    "update messages set created_at = created_at - interval '1 day' where id = any($1)",
    [directMessages.slice(0, 2).map((message) => message.id)],
  );
  await api("Bob").messages.markRead({
    conversationId: direct.id,
    messageId: directMessages.at(-1)!.id,
  });
  await api("Lena").follows.follow({ userId: people.Alice });
  await api("Alice").follows.accept({ userId: people.Lena });
  await api("Lena").comments.create({
    linkId: links[0]!.id,
    body: "Do you have a favorite channel?",
  });
  // Set E2E_MORE_SAMPLES=1 for months of extra people and links while clicking through by hand.
  // Tests rely on the exact data above, so they never set it.
  if (process.env.E2E_MORE_SAMPLES === "1")
    await seedMore(database, registerFixture, people, week, reading);
  return {
    people,
    week,
    older,
    links,
    privateLink,
    reading,
    notes,
    locked,
    conversationId: chat.id,
    conversationShortId: chat.shortId,
    directConversationId: direct.id,
  };
}
// [title, url] per category, as people would save them; the category is stored as given.
const catalog: Record<string, [title: string, url: string][]> = {
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
const samplePeople: [
  username: string,
  name: string,
  visibility: "public" | "private",
  weeks: number,
  follows: string,
][] = [
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
const aliceGroups: Record<string, string> = {
  book: "Reading",
  music: "Listening",
  podcast: "Listening",
  video: "Watch later",
};
const lockedGroups: Record<string, string> = { article: "Research", note: "Someday" };
const sampleGroups: Record<string, string> = {
  book: "Reading",
  article: "Reading",
  music: "Listening",
  video: "Watching",
};
async function seedMore(
  database: Database,
  registerFixture: RegisterFixture,
  people: Record<Person, string>,
  week: string,
  reading: Group,
) {
  // Fixed seed, so every reset makes the same data relative to this week.
  let state = 7;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));
  const ids = Object.fromEntries(Object.entries(people).map(([n, id]) => [n.toLowerCase(), id]));
  const hidden = new Set(["alice", "iris", "mia"]);
  for (const [username, name, visibility] of samplePeople) {
    const result = await registerFixture({
      body: { name, username, email: username + "@test.example", password: "test-password-123" },
    });
    ids[username] = result.user.id;
    if (visibility === "private") hidden.add(username);
  }
  const userId = (username: string) => {
    const id = ids[username];
    if (!id) throw new Error(`Unknown sample person: ${username}`);
    return id;
  };
  const api = (username: string) =>
    createRouterClient(appRouter, { context: database.context(userId(username)) });
  for (const [username, , profileVisibility] of samplePeople)
    await api(username).profiles.update({ profileVisibility });
  const follow = async (from: string, to: string) => {
    await api(from).follows.follow({ userId: userId(to) });
    if (hidden.has(to)) await api(to).follows.accept({ userId: userId(from) });
  };
  const followed = samplePeople.slice(0, 8).map(([username]) => username);
  for (const username of followed) await follow("alice", username);
  for (const [username, , , , follows] of samplePeople)
    for (const to of follows.split(" ").filter(Boolean)) await follow(username, to);
  await follow("lena", "sofia_marques");
  await follow("lena", "elena_p");
  // Everyone saves from a shuffled deck, so a week never repeats a link.
  const authors: [username: string, weeks: number][] = [
    ["alice", 28],
    ["lena", 20],
    ["amir", 16],
    ["iris", 14],
    ["bob", 10],
    ...samplePeople.map(([username, , , weeks]) => [username, weeks] as [string, number]),
  ];
  const alice = { ...aliceGroups, ...lockedGroups };
  const newcomers = new Set(samplePeople.map(([username]) => username));
  const monday = new Date(week + "T00:00:00Z").getTime();
  const now = Date.now();
  const today = now - (now % 86_400_000);
  const rows = [];
  for (const [username, weeks] of authors) {
    const groups: Record<string, Group> = username === "alice" ? { Reading: reading } : {};
    const groupFor = async (category: string) => {
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
      [deck[i], deck[j]] = [deck[j]!, deck[i]!];
    }
    let next = 0;
    for (let back = 0; back < weeks; back++) {
      if (quietWeeks.has(back) || random() < 0.25) continue;
      const roll = random();
      const count = roll < 0.4 ? pick(1, 2) : roll < 0.75 ? pick(3, 7) : pick(8, 25);
      for (let n = 0; n < count; n++) {
        const sample = deck[next++ % deck.length]!;
        const day = Math.min(monday + (pick(0, 6) - back * 7) * 86_400_000, today);
        const time = Math.min(day + pick(7 * 60, 22 * 60) * 60_000, now - n * 60_000);
        rows.push({
          owner_id: userId(username),
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
  const { rows: saved } = await database.client.query<{
    id: string;
    owner_id: string;
    group_id: string | null;
  }>(
    `insert into links (owner_id, group_id, url, title, category, saved_on, created_at)
     select * from jsonb_to_recordset($1::jsonb) as x(owner_id text, group_id uuid, url text,
       title text, category text, saved_on date, created_at timestamptz)
     returning id, owner_id, group_id`,
    [JSON.stringify(rows)],
  );
  // Alice favorites some of her own links and stars visible ones from people she follows.
  const following = new Set(["lena", "amir", "iris", "bob", ...followed].map((u) => ids[u]));
  const locked = new Set(
    (
      await database.client.query<{ id: string }>(
        "select id from groups where visibility = 'private'",
      )
    ).rows.map((g) => g.id),
  );
  for (const link of saved) {
    if (link.owner_id === ids.alice && random() < 0.12)
      await api("alice").favorites.add({ linkId: link.id });
    else if (
      following.has(link.owner_id) &&
      (link.group_id === null || !locked.has(link.group_id)) &&
      random() < 0.06
    )
      await api("alice").stars.add({ linkId: link.id });
  }
  await polishSamples(database, api, userId);
}
// The exact test data uses placeholders. With extra samples, give it what a real account has:
// full names, real addresses and notes, and conversations and comments spread over days.
async function polishSamples(
  database: Database,
  api: (username: string) => AppRouterClient,
  userId: (username: string) => string,
) {
  const sql = (text: string, values: unknown[] = []) => database.client.query(text, values);
  const minutesAgo = "now() - $2::int * interval '1 minute'";
  const linkOf = async (username: string, title: string) => {
    const { rows } = await database.client.query<{ id: string }>(
      "select id from links where owner_id = $1 and title = $2 order by saved_on desc limit 1",
      [userId(username), title],
    );
    if (!rows[0]) throw new Error(`${username} has no sample link “${title}”.`);
    return rows[0].id;
  };
  for (const [username, name] of [
    ["alice", "Alice Moreau"],
    ["bob", "Bob Chen"],
    ["lena", "Lena Fischer"],
    ["amir", "Amir Nasser"],
    ["iris", "Iris Laurent"],
    ["mia", "Mia Koch"],
    ["noah", "Noah Weber"],
  ] as const)
    await api(username).profiles.update({ name });
  await sql(
    `update links set title = x.title, url = x.url, category = x.category, description = x.note,
       created_at = now() - x.minutes * interval '1 minute',
       updated_at = now() - x.minutes * interval '1 minute'
     from jsonb_to_recordset($2::jsonb)
       as x(placeholder text, title text, url text, category text, note text, minutes int)
     where owner_id = $1 and links.title = x.placeholder`,
    [
      userId("alice"),
      JSON.stringify([
        {
          placeholder: "Are.na",
          title: "Are.na",
          url: "https://www.are.na",
          category: "tool",
          minutes: 600,
        },
        {
          placeholder: "In Rainbows",
          title: "Radiohead – In Rainbows",
          url: "https://open.spotify.com/album/5vkqYmiPBYLaalcmjujWxK",
          category: "music",
          note: "For slow Sunday cooking.",
          minutes: 420,
        },
        {
          placeholder: "Design Engineering",
          title: "Design Engineering",
          url: "https://designengineering.io",
          category: "article",
          minutes: 300,
        },
        {
          placeholder: "The Shape of Design",
          title: "The Shape of Design",
          url: "https://shapeofdesignbook.com",
          category: "book",
          note: "Frank Chimero on why we make things. Short chapters, one per train ride.",
          minutes: 180,
        },
        {
          placeholder: "Working notes",
          title: "Studio working notes",
          url: "https://www.notion.so/Studio-working-notes-7f3a2c1e",
          category: "note",
          minutes: 40,
        },
        {
          placeholder: "Earlier notes",
          title: "Type workshop notes",
          url: "https://www.notion.so/Type-workshop-notes-2b9d41a7",
          category: "note",
          minutes: 10080,
        },
      ]),
    ],
  );
  // Others' placeholder links ("Lena · Ways of Seeing") make way for their sample ones.
  await sql("delete from links where title like '% · %'");
  // The test conversations move back four days, below the ones made here. Lena's comment
  // follows Alice saving Are.na.
  await sql("update messages set created_at = created_at - interval '4 days'");
  await sql("update conversation_members set read_at = read_at - interval '4 days'");
  await sql("update conversations set updated_at = updated_at - interval '4 days'");
  await sql(
    "update comments set created_at = now() - interval '500 minutes', updated_at = now() - interval '500 minutes'",
  );
  // [sender, minutes ago, body, the sender's link to attach, index of the message replied to]
  type Line = [from: string, minutes: number, body: string, link?: string, replyTo?: number];
  const converse = async (members: string[], lines: Line[], readBy: string[]) => {
    const [creator, ...others] = members;
    const { id } = await api(creator!).messages.createConversation({
      recipientIds: others.map(userId),
    });
    const sent = [];
    for (const [from, minutes, body, link, replyTo] of lines) {
      const message = await api(from).messages.send({
        conversationId: id,
        clientId: crypto.randomUUID(),
        body,
        linkId: link && (await linkOf(from, link)),
        replyToMessageId: replyTo === undefined ? undefined : sent[replyTo]!.id,
      });
      await sql(`update messages set created_at = ${minutesAgo} where id = $1`, [
        message.id,
        minutes,
      ]);
      sent.push(message);
    }
    await sql(
      "update conversations set updated_at = (select max(created_at) from messages where conversation_id = $1) where id = $1",
      [id],
    );
    for (const reader of readBy)
      await api(reader).messages.markRead({ conversationId: id, messageId: sent.at(-1)!.id });
  };
  await converse(
    ["alice", "kwatanabe", "priya_r"],
    [
      [
        "kwatanabe",
        2900,
        "Found one for November. Sleeps six and has a sauna.",
        "Cabin in the Black Forest",
      ],
      ["priya_r", 2890, "Booking my train tonight."],
      ["alice", 2880, "I’m in. I’ll bring the board games."],
    ],
    ["alice", "kwatanabe", "priya_r"],
  );
  await converse(
    ["alice", "theolindqvist"],
    [
      ["theolindqvist", 190, "For your flight tomorrow.", "Brian Eno – Music for Airports"],
      ["alice", 180, "Perfect. Downloading it now."],
      ["theolindqvist", 95, "Tell me if it beats the noise-cancelling."],
    ],
    ["theolindqvist"],
  );
  await converse(
    ["alice", "sofia_marques"],
    [
      ["sofia_marques", 1450, "What are you reading on the train these days?"],
      ["alice", 1440, "This one. Short chapters, perfect for the U8.", "The Shape of Design"],
      ["sofia_marques", 1435, "Frank Chimero! I loved his essay on the grain of the web."],
      ["alice", 50, "I’m halfway through. Want it after?"],
      ["sofia_marques", 45, "Yes please. I’ll trade you Piranesi.", undefined, 1],
      ["alice", 12, "Deal. Bring it to brunch?"],
    ],
    ["alice", "sofia_marques"],
  );
  // [author, link owner, link title, minutes ago, body]
  for (const [author, owner, title, minutes, body] of [
    [
      "kwatanabe",
      "kwatanabe",
      "Ceramics studio Kreuzberg",
      300,
      "@alice this is the studio with the Thursday evening class.",
    ],
    [
      "sofia_marques",
      "alice",
      "The Shape of Design",
      130,
      "Chapter four is the one. Tell me when you get there.",
    ],
    [
      "theolindqvist",
      "alice",
      "Radiohead – In Rainbows",
      35,
      "Reckoner is still the best song to cook to.",
    ],
    ["kwatanabe", "alice", "Radiohead – In Rainbows", 80, "The vinyl pressing is worth it."],
  ] as const) {
    const comment = await api(author).comments.create({ linkId: await linkOf(owner, title), body });
    await sql(
      `update comments set created_at = ${minutesAgo}, updated_at = ${minutesAgo} where id = $1`,
      [comment.id, minutes],
    );
  }
  await sql(
    "update activities a set created_at = c.created_at from comments c where a.comment_id = c.id",
  );
  // People followed each other over the past week; the two open requests arrived today.
  await sql(
    `update activities a set created_at = now() - interval '2 days' - o.n * interval '5 hours'
     from (select id, row_number() over (order by created_at, id) as n from activities
       where type in ('follow', 'accepted') or request_status in ('accepted', 'declined')) o
     where a.id = o.id`,
  );
  await sql(
    `update activities a set created_at = now() - interval '6 hours' - o.n * interval '3 hours'
     from (select id, row_number() over (order by created_at, id) as n from activities
       where request_status = 'pending') o
     where a.id = o.id`,
  );
}
