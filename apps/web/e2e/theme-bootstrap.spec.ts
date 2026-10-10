import { expect, test } from "@playwright/test";

// Stop application JavaScript: appearance must already be correct before React can run.
for (const scenario of [
  { preference: "dark", system: "light", expected: "dark" },
  { preference: "light", system: "dark", expected: "light" },
  { preference: "system", system: "dark", expected: "dark" },
  { preference: null, system: "light", expected: "light" },
  { preference: "invalid", system: "dark", expected: "dark" },
] as const) {
  test(`first paint: saved ${scenario.preference} on ${scenario.system} system, before app JS`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scenario.system });
    await page.addInitScript((preference) => {
      localStorage.removeItem("index.theme");
      if (preference !== null) localStorage.setItem("index.theme", preference);
    }, scenario.preference);
    await page.route(/\/(assets\/.*\.js|src\/main\.tsx)(\?.*)?$/, (route) => route.abort());
    await page.route("**/login", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "content-security-policy":
            "script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'",
        },
      });
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const bootstrap = page.waitForResponse((response) => response.url().endsWith("/theme.js"));
    await page.goto("/login");
    expect((await bootstrap).ok()).toBe(true);
    await expect(page.locator("html")).toHaveClass(scenario.expected);
    await expect(page.locator("html")).toHaveCSS("color-scheme", scenario.expected);
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      scenario.expected === "dark" ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)",
    );
    await expect(page.locator("#app")).toBeEmpty();
    expect(errors).toEqual([]);
  });
}

test("blocked localStorage still follows the system before application startup", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get: () => {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    });
  });
  await page.route(/\/(assets\/.*\.js|src\/main\.tsx)(\?.*)?$/, (route) => route.abort());
  await page.goto("/login");
  await expect(page.locator("html")).toHaveClass("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect
    .poll(() => page.evaluate(() => window.matchMedia("(prefers-color-scheme: dark)").matches))
    .toBe(false);
  await expect(page.locator("html")).toHaveClass("light");
});
