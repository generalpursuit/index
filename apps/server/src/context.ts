import { notificationCapabilities } from "./notifications/config";
import type { Context as ApiContext } from "@index/api/context";

import { ENV } from "./env.server";
import { r2FileStore } from "./files";
import { r2MediaStore } from "./media";
import { getDb } from "./services";
import { createAuth } from "./services";
import { beginDispatch, liveServices } from "./live/services";

export async function createContext(
  request: Request,
  backgroundTask: (task: Promise<unknown>) => void,
): Promise<ApiContext> {
  const db = getDb();
  const session = await (
    await createAuth(db, backgroundTask)
  ).api.getSession({
    headers: request.headers,
  });
  return {
    db,
    session,
    live: liveServices(request),
    dispatch: async () => {
      const finish = await beginDispatch();
      return () => backgroundTask(finish());
    },
    notifications: await notificationCapabilities(ENV),
    fetchPage,
    fetchImport: (url, init) => fetch(url, init),
    media: r2MediaStore(ENV.MEDIA, ENV.BETTER_AUTH_URL),
    files: r2FileStore(ENV.MESSAGE_FILES),
  };
}

// Cloudflare keeps fetched pages for an hour, so a link saved again soon is read only once.
const fetchPage: ApiContext["fetchPage"] = (url, init) =>
  fetch(url, { ...init, cf: { cacheEverything: true, cacheTtl: 3600 } });

export type Context = Awaited<ReturnType<typeof createContext>>;
