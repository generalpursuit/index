import { trustedWebOrigins } from "@index/auth/origins";
import { createApp } from "./app";
import { createContext } from "./context";
import { desktopOrigins, ENV } from "./env.server";
import { readPhoto } from "./media";
import { runNotifications } from "./notifications/worker";
import { createAuth } from "./services";

const app = createApp({
  origins: [...trustedWebOrigins(ENV.CORS_ORIGIN, ENV.AUTH_TRUSTED_ORIGINS), ...desktopOrigins],
  auth: (backgroundTask) => createAuth(undefined, backgroundTask),
  createContext,
  readMedia: (key) => readPhoto(ENV.MEDIA, key),
});

// Postgres is the durable queue. Cron recovers interrupted delivery attempts.
export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, _env: unknown, ctx: ExecutionContext) {
    ctx.waitUntil(runNotifications());
  },
};
