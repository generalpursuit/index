export const releaseBranches = { staging: "staging", production: "main" } as const;
export type ReleaseStage = keyof typeof releaseBranches;

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
  return {
    webName,
    serverName,
    webDomain,
    apiDomain,
    webURL: `https://${webDomain ?? `${webName}.${subdomain}.workers.dev`}`,
    apiURL: `https://${apiDomain ?? `${serverName}.${subdomain}.workers.dev`}`,
  };
}
