import { apiURL, webURL, webPort } from "./e2e/urls";
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: webURL,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      // This VM has ample shared memory; the default fallback fills its small /tmp mount.
      ignoreDefaultArgs: process.platform === "linux" ? ["--disable-dev-shm-usage"] : undefined,
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 960 } },
    },
  ],
  webServer: [
    {
      command: "bun e2e/server.ts",
      url: apiURL + "/health",
      timeout: 90_000,
      reuseExistingServer: false,
    },
    {
      command:
        process.env.E2E_PRODUCTION === "1"
          ? `bun run serve --host localhost --port ${webPort} --strictPort`
          : `VITE_SERVER_URL=${apiURL} bun run dev:bare --host localhost --port ${webPort} --strictPort`,
      url: webURL,
      timeout: 90_000,
      reuseExistingServer: false,
    },
  ],
});
