import type { MiddlewareHandler } from "hono";

/** Clients identify their release as `<platform>/<version>`, e.g. `desktop/0.2.0`. */
export const clientHeader = "X-Index-Client";

/**
 * The oldest release each client may still use. Raise one only after a release with
 * compatible clients is published; older clients then receive 426 and must update.
 */
export const minimumClientVersions = {
  web: "0.2.0",
  desktop: "0.2.0",
  ios: "0.2.0",
} as const;

// A staging pre-release counts as its release, so staging builds pass the same minimum.
function release(version: string | undefined) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.]+)?$/.exec(version ?? "");
  return match?.slice(1).map(Number);
}

/** Unidentified or unknown clients are not gated; only known releases below the minimum are. */
export function isUnsupportedClient(identity: string | undefined) {
  const [platform, version] = identity?.split("/") ?? [];
  if (!platform || !Object.hasOwn(minimumClientVersions, platform)) return false;
  const current = release(version);
  const minimum = release(minimumClientVersions[platform as keyof typeof minimumClientVersions]);
  if (!current || !minimum) return false;
  const different = current.findIndex((part, i) => part !== minimum[i]);
  return different >= 0 && current[different]! < minimum[different]!;
}

export const clientVersionGate: MiddlewareHandler = async (c, next) => {
  if (!isUnsupportedClient(c.req.header(clientHeader))) return next();
  return c.json({ code: "CLIENT_UPDATE_REQUIRED", message: "Update Index to continue." }, 426);
};
