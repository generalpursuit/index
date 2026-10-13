import { expect, test, type Page } from "@playwright/test";
import { apiURL } from "./urls";

// The macOS host sets this before the first paint; browsers and other platforms keep 0.
// This exercises the page's side only, not the native titlebar view.
const inset = 28;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}

/** What a click across the middle of the band would land on. */
function band(page: Page) {
  return page.evaluate((inset) => {
    const width = document.documentElement.clientWidth;
    return Array.from({ length: 9 }, (_, i) => {
      const element = document.elementFromPoint(((i + 0.5) * width) / 9, inset / 2);
      return element?.getAttribute("data-slot") ?? element?.classList[0] ?? element?.tagName;
    });
  }, inset);
}

async function settled(page: Page, selector: string) {
  await expect
    .poll(() =>
      page
        .locator(selector)
        .evaluate((el) => el.getAnimations().filter((a) => a.playState === "running").length),
    )
    .toBe(0);
}

for (const viewport of [
  { width: 1024, height: 600 },
  { width: 360, height: 600 },
]) {
  test(`page leaves the titlebar band to window controls at ${viewport.width}px`, async ({
    page,
    request,
  }) => {
    await request.post(apiURL + "/_test/reset");
    await page.setViewportSize(viewport);
    await page.addInitScript((inset) => {
      // WebKit runs the host's script once <html> exists; Chromium runs this before it does.
      new MutationObserver((_, observer) => {
        if (!document.documentElement) return;
        observer.disconnect();
        document.documentElement.style.setProperty("--titlebar-inset", `${inset}px`);
      }).observe(document, { childList: true });
    }, inset);
    await login(page);
    // The page background fills the band; scrolling content starts below it.
    expect(await band(page)).toEqual(Array(9).fill("index-app"));
    const main = await page.locator("#app-content").boundingBox();
    expect(main!.y).toBe(inset);
    const phone = viewport.width <= 700;
    if (!phone) expect((await page.locator(".app-nav").boundingBox())!.y).toBe(inset);
    await page.screenshot({ path: `test-results/titlebar-${viewport.width}-page.png` });

    await page.locator('.week-page[data-active="true"] .own-links .link-open').first().click();
    const post = page.getByRole("dialog", { name: "Post", exact: true });
    await expect(post).toBeVisible();
    await settled(page, '[role="dialog"]');
    // The backdrop dims the band like the rest of the window; the dialog stays clear of it.
    // A sheet's transparent viewport lies over its backdrop.
    const backdrop = page.locator(
      phone ? '[data-slot="drawer-backdrop"]' : '[data-slot="dialog-overlay"]',
    );
    expect((await backdrop.boundingBox())!.y).toBe(0);
    expect(await band(page)).toEqual(Array(9).fill(phone ? "drawer-viewport" : "dialog-overlay"));
    expect((await post.boundingBox())!.y).toBeGreaterThanOrEqual(inset + 16);
    await page.screenshot({ path: `test-results/titlebar-${viewport.width}.png` });
  });
}
