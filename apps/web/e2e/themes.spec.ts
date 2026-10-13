import { expect, test, type Page } from "@playwright/test";
import { apiURL } from "./urls";

async function login(page: Page, name = "alice") {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}
async function settings(page: Page, phone: boolean) {
  if (phone) await page.getByRole("link", { name: "Your profile", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("radio", { name: "System", exact: true })).toBeVisible();
}
async function assertContrast(page: Page, selector: string) {
  const ratio = await page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const parse = (color: string) => (color.match(/[\d.]+/g) ?? []).map(Number);
      const foreground = parse(getComputedStyle(element).color);
      let parent: Element | null = element;
      let background = [255, 255, 255];
      while (parent) {
        const color = parse(getComputedStyle(parent).backgroundColor);
        if (color.length === 3 || color[3] === 1) {
          background = color;
          break;
        }
        parent = parent.parentElement;
      }
      const luminance = (color: number[]) =>
        color.slice(0, 3).reduce((sum, channel, i) => {
          const s = channel / 255;
          return (
            sum +
            (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]!
          );
        }, 0);
      const a = luminance(foreground),
        b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
  expect(ratio, `${selector} foreground/background contrast`).toBeGreaterThanOrEqual(4.5);
}

test.beforeEach(async ({ request }) => {
  await request.post(apiURL + "/_test/reset");
});

for (const phone of [false, true]) {
  test(`appearance follows system, persists and survives account changes (${phone ? "phone" : "desktop"})`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 960 });
    await page.emulateMedia({ colorScheme: "light" });
    await login(page);
    await settings(page, phone);
    await expect(page.getByRole("radio", { name: "System", exact: true })).toBeChecked();
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass("dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveClass("light");
    // Native radio keyboard navigation works in the page and in the focus-trapped sheet.
    await page.getByRole("radio", { name: "System", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Light", exact: true })).toBeChecked();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
    await expect(page.locator("html")).toHaveClass("dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveClass("dark");
    await page.reload();
    await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem("index.theme"))).toBe("dark");
    const tab = await context.newPage();
    await tab.goto("/settings");
    await expect(tab.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
    await tab.getByRole("radio", { name: "Light", exact: true }).check();
    await expect(page.getByRole("radio", { name: "Light", exact: true })).toBeChecked();
    await tab.close();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/login/);
    await expect(page.locator("html")).toHaveClass("light");
    await login(page, "lena");
    await settings(page, phone);
    await expect(page.getByRole("radio", { name: "Light", exact: true })).toBeChecked();
    await page.getByRole("radio", { name: "System", exact: true }).check();
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass("dark");
  });

  for (const appearance of ["Light", "Dark"] as const) {
    test(`${appearance} contrast, layout, overlays and forms (${phone ? "phone" : "desktop"})`, async ({
      page,
    }) => {
      const viewport = phone ? { width: 390, height: 844 } : { width: 1440, height: 960 };
      await page.setViewportSize(viewport);
      await login(page);
      await settings(page, phone);
      await page.getByRole("radio", { name: appearance, exact: true }).check();
      await assertContrast(page, ".settings-identity strong");
      await assertContrast(page, ".settings-identity span");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBe(0);
      await page.screenshot({
        path: `test-results/themes-${appearance}-${viewport.width}-settings.png`,
      });
      await page.getByRole("button", { name: "Edit profile", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Edit profile", exact: true });
      await expect(editor.getByLabel("Name", { exact: true })).toBeVisible();
      await assertContrast(page, ".edit-profile input");
      const bounds = await editor.boundingBox();
      const renderedWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(renderedWidth);
      const nameBounds = await editor.getByLabel("Name", { exact: true }).boundingBox();
      expect(nameBounds!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(nameBounds!.x + nameBounds!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
      await page.screenshot({
        path: `test-results/themes-${appearance}-${viewport.width}-editor.png`,
      });
      await expect(
        page
          .locator(phone ? '[data-slot="drawer-backdrop"]' : '[data-slot="dialog-overlay"]')
          .last(),
      ).toHaveCSS(
        "background-color",
        appearance === "Light" ? "rgba(0, 0, 0, 0.4)" : "rgba(0, 0, 0, 0.7)",
      );
      await editor.getByLabel("Name", { exact: true }).fill("Theme test name");
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(editor).toHaveCount(0);
      await expect(page.locator(".settings-identity strong")).toHaveText("Theme test name");
      // Toasts are quiet cards in the app's type and surface colors.
      const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Profile saved" });
      await expect(toast).toHaveCSS("font-family", /Geist/);
      await assertContrast(page, "[data-sonner-toast]");
      await page.goto("/");
      await expect(page.locator('.week-page[data-active="true"] .link-row').first()).toBeVisible();
      await assertContrast(page, '.week-page[data-active="true"] .link-open');
      await assertContrast(page, '.week-page[data-active="true"] .link-domain');
      const carousel = await page
        .locator('.week-page[data-active="true"] .friends-carousel')
        .boundingBox();
      expect(carousel!.y + carousel!.height).toBeLessThanOrEqual(viewport.height);
      await page.screenshot({
        path: `test-results/themes-${appearance}-${viewport.width}-feed.png`,
      });
      // Post labels and menus remain readable when portaled out of the application shell.
      await page.locator('.week-page[data-active="true"] .own-links .link-open').first().click();
      const post = page.getByRole("dialog", { name: "Post", exact: true });
      await assertContrast(page, ".post-label");
      await post.getByRole("link", { name: "Edit", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Edit link", exact: true })
        .getByRole("button", { name: /^Group:/ })
        .click();
      await expect(page.getByRole("menu")).toBeVisible();
      await assertContrast(page, '[data-slot="dropdown-menu-radio-item"]');
      await page.screenshot({
        path: `test-results/themes-${appearance}-${viewport.width}-menu.png`,
      });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
    });
  }
}
