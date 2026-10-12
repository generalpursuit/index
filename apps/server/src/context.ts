import { notificationCapabilities } from "./notifications/config";
import type { Context as ApiContext } from "@index/api/context";
import type { Context as HonoContext } from "hono";

import { ENV } from "./env.server";
import { r2MediaStore } from "./media";
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
    notifications: await notificationCapabilities(ENV),
    fetchPage,
    media: r2MediaStore(ENV.MEDIA, ENV.BETTER_AUTH_URL),
  };
}

// Cloudflare keeps fetched pages for an hour, so a link saved again soon is read only once.
const fetchPage: ApiContext["fetchPage"] = (url, init) =>
  fetch(url, { ...init, cf: { cacheEverything: true, cacheTtl: 3600 } });

export type Context = Awaited<ReturnType<typeof createContext>>;
