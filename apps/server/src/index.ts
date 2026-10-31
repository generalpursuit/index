import { sweepStagedFiles } from "@index/api/features/messages/service";
import { trustedWebOrigins } from "@index/auth/origins";
import { createApp } from "./app";
import { createContext } from "./context";
import { desktopOrigins, ENV } from "./env.server";
import { r2FileStore } from "./files";
import { readPhoto } from "./media";
import { cleanup } from "@index/api/features/notifications/repository";
import { beginDispatch, hub, recoverDispatch } from "./live/services";
import { createAuth, getDb } from "./services";
export { OutboxClock } from "./live/objects";
export { AccountHub } from "./live/hub";

const app = createApp({
  origins: [...trustedWebOrigins(ENV.CORS_ORIGIN, ENV.AUTH_TRUSTED_ORIGINS), ...desktopOrigins],
  auth: (backgroundTask) => createAuth(undefined, backgroundTask),
  createContext,
  readMedia: (key) => readPhoto(ENV.MEDIA, key),
  beginMutation: beginDispatch,
  connect: (userId, request) => hub(userId).fetch(request),
});

// One daily maintenance wake. Expiry checks never depend on physical cleanup.
export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, _env: unknown, ctx: ExecutionContext) {
    ctx.waitUntil(
      Promise.allSettled([
        cleanup(getDb()),
        sweepStagedFiles(getDb(), r2FileStore(ENV.MESSAGE_FILES)),
      ]).then(async (results) => {
        if (results.some((r) => r.status === "rejected")) console.warn("Daily cleanup interrupted");
        await recoverDispatch();
      }),
    );
  },
};
