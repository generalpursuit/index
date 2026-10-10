import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { releaseBranches } from "./deployment";

/** Run locally with the admin profile; CI never receives token-management credentials. */
export default Alchemy.Stack(
  "index-github",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
    const neonKey = yield* Config.Redacted("NEON_API_KEY");
    const subdomain = yield* Config.String("WORKERS_SUBDOMAIN");
    const repo = { owner: "generalpursuit", repository: "index" };
    for (const stage of Object.keys(releaseBranches)) {
      const environment = stage;
      const token = yield* Cloudflare.ApiToken.AccountApiToken(`${stage}-deploy-token`, {
        name: `index-${stage}-github-actions`,
        accountId,
        policies: [
          {
            effect: "allow",
            permissionGroups: [
              "Workers Scripts Write",
              "Workers R2 Storage Write",
              "Account Settings Read",
              "Secrets Store Write",
              "Workers Tail Read",
            ],
            resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
          },
        ],
      });
      yield* GitHub.Secret(`${stage}-cloudflare-token`, {
        ...repo,
        environment,
        name: "CLOUDFLARE_API_TOKEN",
        value: token.value,
      });
      yield* GitHub.Secret(`${stage}-neon-key`, {
        ...repo,
        environment,
        name: "NEON_API_KEY",
        value: neonKey,
      });
      for (const [name, value] of Object.entries({
        CLOUDFLARE_ACCOUNT_ID: accountId,
        WORKERS_SUBDOMAIN: subdomain,
      })) {
        yield* GitHub.Variable(`${stage}-${name.toLowerCase()}`, {
          ...repo,
          environment,
          name,
          value,
        });
      }
    }
    return { repository: "https://github.com/generalpursuit/index/settings/environments" };
  }),
);
