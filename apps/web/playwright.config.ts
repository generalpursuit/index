import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
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
      command: "bun e2e/server.mjs",
      url: "http://localhost:3002/health",
      timeout: 90_000,
      reuseExistingServer: false,
    },
    {
      command:
        "VITE_SERVER_URL=http://localhost:3002 bun run dev:bare --host localhost --port 4173 --strictPort",
      url: "http://localhost:4173",
      timeout: 90_000,
      reuseExistingServer: false,
    },
  ],
});
