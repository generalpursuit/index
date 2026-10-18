/** Both stages release from main; the release dispatch input chooses the stage. */
export const releaseBranch = "main";
export const releaseStages = ["staging", "production"] as const;
export type ReleaseStage = (typeof releaseStages)[number];

export function isReleaseStage(stage: string): stage is ReleaseStage {
  return stage === "staging" || stage === "production";
}

/** Stable release names let the API know the web origin before either Worker exists. */
export function releaseDeployment(stage: string, env: Record<string, string | undefined>) {
  if (!isReleaseStage(stage)) {
    if (env.CI === "true") throw new Error("CI deployments must target staging or production.");
    return undefined;
  }
  const subdomain = env.WORKERS_SUBDOMAIN;
  if (!subdomain || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(subdomain))
    throw new Error("Set WORKERS_SUBDOMAIN to your Cloudflare workers.dev subdomain.");
  const webName = `index-${stage}-web`;
  const serverName = `index-${stage}-api`;
  const domain = (value: string | undefined) => {
    if (!value) return undefined;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value))
      throw new Error("Custom domains must be hostnames without a scheme or path.");
    return value;
  };
  const webDomain = domain(env.WEB_DOMAIN);
  const apiDomain = domain(env.API_DOMAIN);
  // workers.dev is a public suffix: a custom web domain calling a workers.dev API is
  // cross-site, and browsers such as Safari then drop the API's session cookie.
  if (!webDomain !== !apiDomain)
    throw new Error("Set WEB_DOMAIN and API_DOMAIN together so web and API share a site.");
  // Extra hostnames that permanently redirect to the web domain.
  const webRedirects = (env.WEB_REDIRECT_DOMAINS ?? "")
    .split(",")
    .map((value) => domain(value.trim()))
    .filter((value) => value !== undefined);
  if (webRedirects.length && !webDomain)
    throw new Error("WEB_REDIRECT_DOMAINS needs a WEB_DOMAIN to redirect to.");
  return {
    webName,
    serverName,
    webDomain,
    webRedirects,
    apiDomain,
    webURL: `https://${webDomain ?? `${webName}.${subdomain}.workers.dev`}`,
    apiURL: `https://${apiDomain ?? `${serverName}.${subdomain}.workers.dev`}`,
  };
}
