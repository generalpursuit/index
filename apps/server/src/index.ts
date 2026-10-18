import { sweepStagedFiles } from "@index/api/features/messages/service";
import { trustedWebOrigins } from "@index/auth/origins";
import { createApp } from "./app";
import { createContext } from "./context";
import { desktopOrigins, ENV } from "./env.server";
import { r2FileStore } from "./files";
import { readPhoto } from "./media";
import { runNotifications } from "./notifications/worker";
import { createAuth, getDb } from "./services";

const app = createApp({
  origins: [...trustedWebOrigins(ENV.CORS_ORIGIN, ENV.AUTH_TRUSTED_ORIGINS), ...desktopOrigins],
  auth: (backgroundTask) => createAuth(undefined, backgroundTask),
  createContext,
  readMedia: (key) => readPhoto(ENV.MEDIA, key),
});

// Postgres is the durable queue. Cron recovers interrupted delivery attempts and, separately,
// removes uploads that were never sent. Each job is its own waitUntil, so a failure in one
// cannot end the run while the other is still deleting.
export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, _env: unknown, ctx: ExecutionContext) {
    ctx.waitUntil(runNotifications());
    ctx.waitUntil(sweepStagedFiles(getDb(), r2FileStore(ENV.MESSAGE_FILES)));
  },
};
