import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Neon from "alchemy/Neon";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { isReleaseStage, releaseDeployment } from "./deployment";
import "varlock/auto-load";

const managedDatabase = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const database = yield* Neon.Project("database", {
    region: "aws-eu-central-1",
    historyRetentionSeconds: 21_600,
    migrations: "../../packages/db/src/migrations",
  }).pipe(Alchemy.RemovalPolicy.retain(stage === "production"));
  const runtimeUrl = database.pooledConnectionUri.pipe(Output.map(Redacted.make));

  return {
    runtimeEnv: { DATABASE_URL: runtimeUrl },
  };
});

export const databaseEnv = managedDatabase.pipe(Effect.map(({ runtimeEnv }) => runtimeEnv));

export const databaseBindings = {
  DATABASE_URL: databaseEnv.pipe(Effect.map(({ DATABASE_URL }) => DATABASE_URL)),
};

export const databaseProviders = Layer.mergeAll(Neon.providers());

/** Profile photos. Private: the server Worker serves them at `/media/*`. */
export const media = Cloudflare.R2.Bucket("media").pipe(
  Alchemy.RemovalPolicy.retain(
    Alchemy.Stack.pipe(Effect.map(({ stage }) => stage === "production")),
  ),
);

/** Files shared in conversations. Private: members read them through the API. */
export const messageFiles = Cloudflare.R2.Bucket("message-files").pipe(
  Alchemy.RemovalPolicy.retain(
    Alchemy.Stack.pipe(Effect.map(({ stage }) => stage === "production")),
  ),
);

// Each release gets a persistent secret; redeploying must not log everyone out.
const authSecret = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  return isReleaseStage(stage)
    ? yield* Alchemy.makeRandom("auth-secret")
    : yield* Config.Redacted("BETTER_AUTH_SECRET");
});

export const server = Cloudflare.Worker(
  "server",
  Alchemy.Stack.useSync(({ stage }) => {
    const release = releaseDeployment(stage, process.env);
    return {
      name: release?.serverName,
      domain: release?.apiDomain,
      main: "../../apps/server/src/index.ts",
      crons: ["* * * * *"],
      // Node.js APIs are on by default from 2026-08-04; workerd warns if nodejs_compat is named.
      compatibility: {
        date: "2026-08-31",
      },
      env: {
        ...databaseBindings,
        CORS_ORIGIN: release?.webURL ?? Config.String("CORS_ORIGIN"),
        BETTER_AUTH_SECRET: authSecret,
        AUTH_TRUSTED_ORIGINS: Config.String("AUTH_TRUSTED_ORIGINS").pipe(Config.withDefault("")),
        AUTH_EMAIL_FROM: Config.String("AUTH_EMAIL_FROM").pipe(Config.withDefault("")),
        RESEND_API_KEY: Config.Redacted("RESEND_API_KEY").pipe(
          Config.withDefault(Redacted.make("")),
        ),
        NOTIFICATIONS_ENABLED: Config.String("NOTIFICATIONS_ENABLED").pipe(Config.withDefault("")),
        VAPID_PUBLIC_KEY: Config.String("VAPID_PUBLIC_KEY").pipe(Config.withDefault("")),
        VAPID_SUBJECT: Config.String("VAPID_SUBJECT").pipe(Config.withDefault("")),
        APNS_KEY_ID: Config.String("APNS_KEY_ID").pipe(Config.withDefault("")),
        APNS_TEAM_ID: Config.String("APNS_TEAM_ID").pipe(Config.withDefault("")),
        APNS_TOPIC: Config.String("APNS_TOPIC").pipe(Config.withDefault("")),
        APNS_ENVIRONMENT: Config.String("APNS_ENVIRONMENT").pipe(Config.withDefault("")),
        VAPID_PRIVATE_KEY: Config.Redacted("VAPID_PRIVATE_KEY").pipe(
          Config.withDefault(Redacted.make("")),
        ),
        APNS_PRIVATE_KEY: Config.Redacted("APNS_PRIVATE_KEY").pipe(
          Config.withDefault(Redacted.make("")),
        ),
        BETTER_AUTH_URL: Cloudflare.Worker.URL,
        MEDIA: media,
        MESSAGE_FILES: messageFiles,
      },
      dev: {
        port: 8080,
      },
    };
  }),
);

export type ServerEnv = Cloudflare.InferEnv<typeof server>;

export default Alchemy.Stack(
  "index",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), databaseProviders),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const release = releaseDeployment(stage, process.env);
    const serverWorker = yield* server;
    const webWorker = yield* Cloudflare.Website.Vite("web", {
      name: release?.webName,
      domain: release?.webDomain && { name: release.webDomain, redirects: release.webRedirects },
      rootDir: "../../apps/web",
      assets: {
        htmlHandling: "auto-trailing-slash",
        notFoundHandling: "single-page-application",
      },
      env: {
        VITE_SERVER_URL: serverWorker.url.as<string>(),
      },
      dev: {
        port: 3000,
      },
    });

    return {
      web: webWorker.url,
      server: serverWorker.url,
    };
  }),
);
