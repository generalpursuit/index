import type { Context as ApiContext } from "@index/api/context";
import type { Context as HonoContext } from "hono";

import { getDb } from "./services";
import { createAuth } from "./services";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions): Promise<ApiContext> {
  const db = getDb();
  const session = await (
    await createAuth(db)
  ).api.getSession({
    headers: context.req.raw.headers,
  });
  return {
    db,
    session,
    fetchPage,
  };
}

// Cloudflare keeps fetched pages for an hour, so a link saved again soon is read only once.
const fetchPage: ApiContext["fetchPage"] = (url, init) =>
  fetch(url, { ...init, cf: { cacheEverything: true, cacheTtl: 3600 } });

export type Context = Awaited<ReturnType<typeof createContext>>;
