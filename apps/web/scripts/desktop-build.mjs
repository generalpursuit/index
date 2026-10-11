import { apiScope } from "./api-scope.mjs";
import { prepareShareExtension, verifyShareExtension } from "./share-extension-build.mjs";
import { spawnSync } from "node:child_process";
import { channels, readBaseConfig, releaseConfig } from "./desktop-channels.mjs";

const argsIn = process.argv.slice(2);
const channelIndex = argsIn.indexOf("--channel");
const channel = channelIndex < 0 ? undefined : argsIn.splice(channelIndex, 2)[1];
if (channelIndex >= 0 && !channels[channel])
  throw new Error("Choose --channel staging or production.");
const local = argsIn.includes("--local");
if (
  channel &&
  (local ||
    argsIn.includes("native-smoke") ||
    argsIn.includes("--without-share-extension") ||
    argsIn.some((arg) => /^(--config|-c|--debug|--no-bundle|--features)(=|$)/.test(arg)))
)
  throw new Error(
    "Release channels cannot use development/test hooks or override their configuration.",
  );
const base = readBaseConfig();
const release = channel ? releaseConfig(channel, base) : {};
if (channel) {
  const selected = channels[channel];
  // A channel's backend is part of its identity, never inherited from a developer's .env.
  process.env.VITE_SERVER_URL = selected.api;
  process.env.INDEX_WEB_URL = selected.web;
  process.env.INDEX_DESKTOP_CHANNEL = channel;
  process.env.INDEX_DESKTOP_IDENTIFIER = selected.identifier;
  process.env.INDEX_SHARE_EXTENSION_ID = `${selected.identifier}.share-mac`;
  process.env.INDEX_SHARE_DISPLAY_NAME = selected.name;
  const prefix = process.env.INDEX_APP_ID_PREFIX || process.env.INDEX_APPLE_TEAM_ID;
  if (prefix) process.env.INDEX_KEYCHAIN_GROUP = `${prefix}.${selected.keychainSuffix}`;
}
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
  ...release,
  app: {
    ...release.app,
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
  !argsIn.includes("--without-share-extension") &&
  !argsIn.includes("native-smoke");
if (sharing) {
  const share = prepareShareExtension({
    local,
    args: argsIn,
    configurationFile: { ...base, ...release },
  });
  config.bundle = { ...config.bundle, macOS: { ...config.bundle?.macOS, ...share.bundle.macOS } };
}
const args = [
  "x",
  "--no-install",
  "tauri",
  "build",
  "--config",
  JSON.stringify(config),
  ...argsIn.filter((arg) => arg !== "--local" && arg !== "--without-share-extension"),
];
const result = spawnSync("bun", args, { stdio: "inherit", env: process.env });
if (result.status === 0 && sharing)
  verifyShareExtension(argsIn, config.productName || base.productName);
process.exit(result.status ?? 1);
