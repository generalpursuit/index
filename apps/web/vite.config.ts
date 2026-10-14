import { themeBootstrap } from "./theme-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    themeBootstrap(),
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      codeSplittingOptions: {
        defaultBehavior: [["component", "pendingComponent"]],
        splitBehavior: ({ routeId }) => (routeId === "/_app" ? [] : undefined),
      },
    }),
    react(),
  ],
});
