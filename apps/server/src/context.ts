import { notificationCapabilities } from "./notifications/config";
import { sessionCaller, type Caller, type Context as ApiContext } from "@index/api/context";
import { verifyMcpAccess } from "@index/auth";
import type { Database } from "@index/db";

import { ENV } from "./env.server";
import { r2FileStore } from "./files";
import { r2MediaStore } from "./media";
import { getDb } from "./services";
import { createAuth } from "./services";
import { beginDispatch, liveServices } from "./live/services";

type BackgroundTask = (task: Promise<unknown>) => void;

/** The context of an API request, for the account whose session it carries, if any. */
export async function createContext(
  request: Request,
  backgroundTask: BackgroundTask,
): Promise<ApiContext> {
  const db = getDb();
  const session = await (
    await createAuth(db, backgroundTask)
  ).api.getSession({
    headers: request.headers,
  });
  return services(db, sessionCaller(session), request, backgroundTask);
}

/** The context of an MCP request, or null unless its Bearer token authorizes an agent. */
export async function createAgentContext(
  request: Request,
  backgroundTask: BackgroundTask,
): Promise<ApiContext | null> {
  const db = getDb();
  const access = await verifyMcpAccess(db, ENV.BETTER_AUTH_URL, request);
  return access && services(db, { kind: "agent", ...access }, request, backgroundTask);
}

async function services(
  db: Database,
  caller: Caller | null,
  request: Request,
  backgroundTask: BackgroundTask,
): Promise<ApiContext> {
  return {
    db,
    caller,
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
