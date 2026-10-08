import { spawnSync } from "node:child_process";

const local = process.argv.includes("--local");
for (const key of ["VITE_SERVER_URL", "VITE_WEB_URL"]) {
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
    (url.protocol !== "https:" &&
      !(local && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
  )
    throw new Error(`${key} must use HTTPS. --local permits loopback HTTP for development builds.`);
}
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
const args = [
  "x",
  "--no-install",
  "tauri",
  "build",
  "--config",
  JSON.stringify(config),
  ...process.argv.slice(2).filter((arg) => arg !== "--local"),
];
const result = spawnSync("bun", args, { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
