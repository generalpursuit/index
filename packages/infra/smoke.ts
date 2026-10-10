import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { appendFile } from "node:fs/promises";
import { releaseDeployment } from "./deployment";

const config = releaseDeployment(process.argv[2] ?? "", process.env);
assert(config, "Pass staging or production.");
const { webURL, apiURL } = config;
async function check() {
  const web = await fetch(webURL, { signal: AbortSignal.timeout(15_000) });
  assert.equal(web.status, 200, "Web must serve successfully");
  const html = await web.text();
  const script = html.match(/<script[^>]+src="([^"]+)"/);
  assert(script, "Web must serve the built application");
  const asset = await fetch(new URL(script[1]!, webURL), { signal: AbortSignal.timeout(15_000) });
  assert.equal(asset.status, 200, "Application assets must load");
  const route = await fetch(webURL + "/settings", {
    headers: { "Sec-Fetch-Mode": "navigate" },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(route.status, 200, "SPA routes must serve successfully");
  const users = await fetch(apiURL + "/api/v1/discovery/users?query=index-deployment-check", {
    headers: { Origin: webURL },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(users.status, 200, "API must read the migrated database");
  assert.equal(
    users.headers.get("access-control-allow-origin"),
    webURL,
    "CORS must match this environment",
  );
  assert.equal(users.headers.get("access-control-allow-credentials"), "true");
  assert(Array.isArray(((await users.json()) as { items?: unknown }).items));
  const session = await fetch(apiURL + "/api/auth/get-session", {
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(session.status, 200, "Authentication endpoint must respond");
  assert.equal(await session.json(), null, "Anonymous requests must have no session");
}
for (let attempt = 1; ; attempt++) {
  try {
    await check();
    break;
  } catch (error) {
    if (attempt === 6) throw error;
    console.log(`Deployment is propagating; retry ${attempt}/5.`);
    await setTimeout(5_000);
  }
}
console.log(`Verified web, assets, routing, database, CORS, and auth: ${webURL}`);
if (process.env.GITHUB_STEP_SUMMARY)
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `Deployed **${process.argv[2]}**\n\n- Web: ${webURL}\n- API: ${apiURL}\n- Smoke checks passed.\n`,
  );
