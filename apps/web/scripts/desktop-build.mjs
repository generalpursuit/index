import { apiScope } from "./api-scope.mjs";
import { prepareShareExtension, verifyShareExtension } from "./share-extension-build.mjs";
import { spawnSync } from "node:child_process";

const local = process.argv.includes("--local");
for (const key of ["VITE_SERVER_URL"]) {
  const raw = process.env[key];
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Set ${key} before building desktop.`);
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(local && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
  )
    throw new Error(`${key} must use HTTPS. --local permits loopback HTTP for development builds.`);
}
process.env.VITE_SERVER_URL = apiScope(process.env.VITE_SERVER_URL);
const config = {
  app: {
    security: {
      csp: {
        "default-src": "'self'",
        "script-src": "'self'",
        "style-src": "'self' 'unsafe-inline'",
        "connect-src": `'self' ipc: http://ipc.localhost ${new URL(process.env.VITE_SERVER_URL).origin}`,
        "img-src": "'self' data: https:",
        "font-src": "'self' data:",
        "object-src": "'none'",
        "base-uri": "'self'",
        "frame-src": "'none'",
      },
    },
  },
};
// Native smoke uses its deliberately separate legacy credential namespace and no extension.
const sharing =
  process.platform === "darwin" &&
  !process.argv.includes("--without-share-extension") &&
  !process.argv.includes("native-smoke");
if (sharing) Object.assign(config, prepareShareExtension({ local, args: process.argv.slice(2) }));
const args = [
  "x",
  "--no-install",
  "tauri",
  "build",
  "--config",
  JSON.stringify(config),
  ...process.argv
    .slice(2)
    .filter((arg) => arg !== "--local" && arg !== "--without-share-extension"),
];
const result = spawnSync("bun", args, { stdio: "inherit", env: process.env });
if (result.status === 0 && sharing) verifyShareExtension(process.argv.slice(2));
process.exit(result.status ?? 1);
