import { linkCategories } from "@index/db/categories";
import { z } from "zod";

import { httpUrlSchema } from "../../shared/schemas";
import { categorize } from "../links/categories";
import { titleFromUrl, type FetchPage } from "../links/metadata";
import type { Link } from "../links/schemas";

// curatee.co is a browser app over a Supabase project. Profiles and their links are public;
// this is the same public read key the site's own pages send.
const api = "https://tcecmfftkemwceeuinjd.supabase.co/rest/v1";
const headers = {
  apikey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjZWNtZmZ0a2Vtd2NlZXVpbmpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgwMjE5NTUsImV4cCI6MjA1MzU5Nzk1NX0.KERZEvWhpNsVc9pcLYkDE6Hosgo1RczDh3sEh0NmcCE",
};
const timeoutMs = 15_000;
const pageSize = 1000;

/** A link from a curatee profile, in the shape Index saves it. */
export type CurateeLink = {
  curateeId: string;
  url: string;
  title: string;
  description: string | null;
  category: Link["category"];
  /** When it was saved on curatee, which decides its day and week here. */
  createdAt: string;
};

const profileRows = z.array(z.object({ id: z.uuid() }));
const linkRows = z.array(
  z.object({
    id: z.uuid(),
    url: z.string().nullable(),
    title: z.string().nullable(),
    category: z.string().nullable(),
    body: z.string().nullable(),
    created_at: z.iso.datetime({ offset: true }),
  }),
);
type LinkRow = z.output<typeof linkRows>[number];

/**
 * Reads every link on a curatee profile, oldest first, or null when no profile has the username.
 * Throws when curatee can't be reached in time or answers with something unexpected.
 */
export async function readCurateeProfile(
  username: string,
  fetchImport: FetchPage,
): Promise<CurateeLink[] | null> {
  const signal = AbortSignal.timeout(timeoutMs);
  async function read<T>(path: string, schema: z.ZodType<T>) {
    const response = await fetchImport(api + path, { headers, signal });
    if (!response.ok) throw new Error(`curatee answered ${response.status} for ${path}`);
    return schema.parse(await response.json());
  }
  const [profile] = await read(
    `/profiles?select=id&username=eq.${encodeURIComponent(username)}`,
    profileRows,
  );
  if (!profile) return null;
  // Supabase caps how many rows one response holds, so reading continues until a page is empty.
  const rows: LinkRow[] = [];
  for (;;) {
    const page = await read(
      `/links?select=id,url,title,category,body,created_at&user_id=eq.${profile.id}` +
        `&order=created_at.asc,id.asc&limit=${pageSize}&offset=${rows.length}`,
      linkRows,
    );
    if (page.length === 0) return rows.flatMap(toLink);
    rows.push(...page);
  }
}

/** Index saves only web links; curatee's own title, note and category are kept. */
function toLink(row: LinkRow): CurateeLink[] {
  const url = httpUrlSchema.safeParse(row.url);
  if (!url.success) return [];
  const title = row.title?.replace(/\s+/g, " ").trim().slice(0, 500);
  return [
    {
      curateeId: row.id,
      url: url.data,
      title: title || titleFromUrl(url.data),
      description: row.body?.trim().slice(0, 10_000) || null,
      category:
        linkCategories.find((category) => category === row.category) ?? categorize(url.data),
      createdAt: row.created_at,
    },
  ];
}
