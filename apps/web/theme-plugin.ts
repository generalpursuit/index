import type { Plugin } from "vite";
import { themeBootstrapScript } from "./src/lib/appearance/store";

/** A blocking external script avoids both a wrong first paint and CSP inline exceptions. */
export function themeBootstrap(): Plugin {
  const filename = "theme.js";
  return {
    name: "index-theme-bootstrap",
    transformIndexHtml: {
      order: "post",
      handler: () => [{ tag: "script", attrs: { src: `/${filename}` }, injectTo: "head-prepend" }],
    },
    configureServer(server) {
      server.middlewares.use(`/${filename}`, (_req, res) => {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.end(themeBootstrapScript);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: filename, source: themeBootstrapScript });
    },
  };
}
