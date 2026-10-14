import { links } from "@index/db/schema/app";
import { createRouterClient } from "@orpc/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import type { Context } from "../../context";
import { appRouter } from "../../routers";
import { createTestDatabase } from "../../testing/database";

type Row = {
  id: string;
  url: string | null;
  title: string | null;
  category: string | null;
  body: string | null;
  created_at: string;
};

const profileIds: Record<string, string> = {
  jona: "64cfbf56-963c-4769-9991-be0d688e355b",
  arne: "2ef4db7d-488c-4a02-8a56-bc2cb5b0633a",
};
const row = (n: number, fields: Partial<Row> = {}): Row => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  url: `https://example.com/articles/${n}`,
  title: `Article ${n}`,
  category: "article",
  body: null,
  created_at: `2026-09-27T${10 + n}:00:00.148858+00:00`,
  ...fields,
});

/** Answers like curatee's Supabase API, holding at most `pageLimit` rows in a response. */
function curatee(profiles: Record<string, Row[]>, pageLimit = 1000) {
  const requests: { url: string; apikey: string | null }[] = [];
  const fetchImport: Context["fetchImport"] = async (url, init) => {
    requests.push({ url, apikey: new Headers(init.headers).get("apikey") });
    const { pathname, searchParams } = new URL(url);
    const value = (name: string) => searchParams.get(name)!.replace(/^eq\./, "");
    if (pathname.endsWith("/profiles")) {
      const id = profileIds[value("username")];
      return Response.json(id && profiles[value("username")] ? [{ id }] : []);
    }
    const name = Object.keys(profileIds).find((key) => profileIds[key] === value("user_id"));
    const offset = Number(searchParams.get("offset"));
    const limit = Math.min(Number(searchParams.get("limit")), pageLimit);
    return Response.json((profiles[name!] ?? []).slice(offset, offset + limit));
  };
  return { requests, fetchImport };
}

describe("curatee imports", () => {
  let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
  before(async () => {
    fixture = await createTestDatabase();
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  after(async () => {
    await fixture?.close();
  });

  const client = (actor: string | null, fetchImport?: Context["fetchImport"]) => {
    const context = fixture.context(actor);
    return createRouterClient(appRouter, {
      context: { ...context, fetchImport: fetchImport ?? context.fetchImport },
    });
  };

  it("saves each link on the day it was saved there, with its title, note and category", async () => {
    const source = curatee({
      jona: [
        row(1, { title: "  PorTAL:\n Portable Task Adaptation ", body: " Worth a reread " }),
        // Saved late in the evening west of UTC: the next day in UTC.
        row(2, {
          url: "https://www.youtube.com/watch?v=bMMv0bZzONg",
          title: "Building Their Own Intelligence",
          category: "video",
          created_at: "2026-09-28T22:30:00-05:00",
        }),
        row(3, {
          url: "https://open.spotify.com/track/2ZWlPOoWh0626oTaHrnl2a",
          category: "podcast",
        }),
        // Categories Index doesn't know fall back to what the URL says.
        row(4, { url: "https://github.com/acme/tool", category: "paper" }),
        row(5, { url: "https://example.com/the-long-read.html", title: " " }),
        // Only web links can be saved.
        row(6, { url: "mailto:someone@example.com" }),
        row(7, { url: null }),
      ],
    });
    const alice = client("alice", source.fetchImport);
    assert.deepEqual(await alice.imports.curatee({ username: " jona " }), { imported: 5 });

    const saved = (await alice.links.listMine({})).items;
    assert.ok(saved.every((link) => link.groupId === null));
    assert.deepEqual(
      saved.map(({ title, url, description, category, savedOn, createdAt }) => ({
        title,
        url,
        description,
        category,
        savedOn,
        createdAt,
      })),
      [
        {
          title: "Building Their Own Intelligence",
          url: "https://www.youtube.com/watch?v=bMMv0bZzONg",
          description: null,
          category: "video",
          savedOn: "2026-09-29",
          createdAt: "2026-09-29T03:30:00.000000Z",
        },
        {
          title: "The long read",
          url: "https://example.com/the-long-read.html",
          description: null,
          category: "article",
          savedOn: "2026-09-27",
          createdAt: "2026-09-27T15:00:00.148858Z",
        },
        {
          title: "Article 4",
          url: "https://github.com/acme/tool",
          description: null,
          category: "tool",
          savedOn: "2026-09-27",
          createdAt: "2026-09-27T14:00:00.148858Z",
        },
        {
          title: "Article 3",
          url: "https://open.spotify.com/track/2ZWlPOoWh0626oTaHrnl2a",
          description: null,
          category: "podcast",
          savedOn: "2026-09-27",
          createdAt: "2026-09-27T13:00:00.148858Z",
        },
        {
          title: "PorTAL: Portable Task Adaptation",
          url: "https://example.com/articles/1",
          description: "Worth a reread",
          category: "article",
          savedOn: "2026-09-27",
          createdAt: "2026-09-27T11:00:00.148858Z",
        },
      ],
    );
    // Weeks follow the original dates, so the links are found where they were saved.
    assert.deepEqual((await alice.links.weeks({ userId: "alice" })).items, [
      { weekStart: "2026-09-28", count: 1 },
      { weekStart: "2026-09-21", count: 4 },
    ]);
    assert.ok(source.requests.every((request) => request.apikey));
    assert.match(source.requests[0]!.url, /\/profiles\?select=id&username=eq\.jona$/);
  });

  it("reads every page of a profile and imports only what is new there", async () => {
    const rows = Array.from({ length: 5 }, (_, n) => row(n + 1));
    const profiles = { arne: rows.slice(0, 3) };
    const source = curatee(profiles, 2);
    const alice = client("alice", source.fetchImport);
    assert.deepEqual(await alice.imports.curatee({ username: "arne" }), { imported: 3 });
    // Pages continue past the response cap until one is empty.
    assert.deepEqual(
      source.requests.slice(1).map((request) => new URL(request.url).searchParams.get("offset")),
      ["0", "2", "3"],
    );

    // A deleted link stays deleted; links added there since are imported.
    const [deleted] = (await alice.links.listMine({})).items;
    await alice.links.delete({ id: deleted!.id });
    profiles.arne = rows;
    assert.deepEqual(await alice.imports.curatee({ username: "arne" }), { imported: 2 });
    assert.deepEqual(await alice.imports.curatee({ username: "arne" }), { imported: 0 });
    assert.equal((await alice.links.listMine({})).items.length, 4);

    // Simultaneous imports save each link once.
    const bob = client("bob", source.fetchImport);
    const results = await Promise.all([
      bob.imports.curatee({ username: "arne" }),
      bob.imports.curatee({ username: "arne" }),
    ]);
    assert.equal(results[0]!.imported + results[1]!.imported, 5);
    assert.equal((await bob.links.listMine({})).items.length, 5);
  });

  it("explains a missing profile or an unavailable curatee without saving anything", async () => {
    const alice = (fetchImport: Context["fetchImport"]) => client("alice", fetchImport);
    await assert.rejects(
      alice(curatee({ jona: [row(1)] }).fetchImport).imports.curatee({ username: "nobody" }),
      { code: "NOT_FOUND", message: "No curatee profile has that username." },
    );
    for (const fetchImport of [
      // The test context is offline.
      undefined,
      async () => new Response("Unavailable", { status: 503 }),
      async () => Response.json({ message: "Invalid API key" }),
      async () => Response.json([{ id: "not-a-uuid" }]),
    ])
      await assert.rejects(client("alice", fetchImport).imports.curatee({ username: "jona" }), {
        code: "BAD_GATEWAY",
        message: "curatee.co can't be reached right now. Try again later.",
      });
    await assert.rejects(client(null).imports.curatee({ username: "jona" }), {
      code: "UNAUTHORIZED",
    });
    for (const username of ["", "jo na", "jona&user_id=eq.1", "x".repeat(65)])
      await assert.rejects(client("alice").imports.curatee({ username }), {
        code: "BAD_REQUEST",
      });
    assert.deepEqual(await fixture.db.select().from(links), []);
  });
});
