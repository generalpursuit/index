import type { Plugin } from "vite";

/**
 * No page of the web app may be framed, not even by Index itself: a transparent frame over a
 * signed consent page turns a click elsewhere into Allow. Nothing frames Index legitimately;
 * the desktop app shows it as its own top-level page.
 */
export const frameProtectionHeaders = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
};

/**
 * Sends the headers from the dev and preview servers, and writes them into the build as the
 * `_headers` rules Cloudflare's asset layer applies to every response of a deployed stage,
 * single-page fallbacks such as `/connect` included.
 */
export function frameProtection(): Plugin {
  const rules = [
    "/*",
    ...Object.entries(frameProtectionHeaders).map(([name, value]) => `  ${name}: ${value}`),
  ].join("\n");
  return {
    name: "index-frame-protection",
    config: () => ({
      server: { headers: frameProtectionHeaders },
      preview: { headers: frameProtectionHeaders },
    }),
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "_headers", source: `${rules}\n` });
    },
  };
}
