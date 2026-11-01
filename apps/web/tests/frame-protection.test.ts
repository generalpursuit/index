import { test } from "node:test";
import assert from "node:assert/strict";
import { frameProtection } from "../frame-protection";

const forbidFraming = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
};

test("deployed builds forbid framing every page through Cloudflare's _headers rules", () => {
  const emitted: { fileName?: string; source?: unknown }[] = [];
  const plugin = frameProtection();
  (plugin.generateBundle as Function).call({ emitFile: (file: object) => emitted.push(file) });
  assert.deepEqual(emitted, [
    {
      type: "asset",
      fileName: "_headers",
      source: "/*\n  Content-Security-Policy: frame-ancestors 'none'\n  X-Frame-Options: DENY\n",
    },
  ]);
});

test("the dev and preview servers forbid framing too", () => {
  const config = (frameProtection().config as Function)();
  assert.deepEqual(config.server.headers, forbidFraming);
  assert.deepEqual(config.preview.headers, forbidFraming);
});
