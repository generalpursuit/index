import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiURL } from "./urls";

type Fixture = { conversationShortId: string; links: { shortId: string; title: string }[] };

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}

async function layout(page: Page, label: string, scope: Locator = page.locator("body")) {
  const metrics = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    vertical: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    appHorizontal: document.querySelector("#app-scroll")
      ? document.querySelector("#app-scroll")!.scrollWidth -
        document.querySelector("#app-scroll")!.clientWidth
      : 0,
  }));
  expect.soft(metrics.horizontal, `${label}: document horizontal overflow`).toBe(0);
  expect.soft(metrics.appHorizontal, `${label}: app horizontal overflow`).toBe(0);
  if (await page.locator(".index-app").count())
    expect.soft(metrics.vertical, `${label}: document scroll outside app`).toBe(0);
  const smallInputs = await scope
    .locator(
      'input:not([type="hidden"]):not([type="file"]):not([type="radio"]):not([type="checkbox"]), textarea, select',
    )
    .evaluateAll((elements) =>
      elements
        .filter((el) => el.getClientRects().length && !el.closest("[inert]"))
        .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
        .map((el) => ({
          label: el.getAttribute("aria-label") ?? el.id,
          font: getComputedStyle(el).fontSize,
        })),
    );
  expect.soft(smallInputs, `${label}: controls must not trigger iOS focus zoom`).toEqual([]);
}

async function dialogLayout(page: Page, name: string) {
  const dialog = page.getByRole("dialog", { name, exact: true });
  await expect(dialog).toBeVisible();
  // Let the sheet's entrance finish before inspecting geometry.
  await expect
    .poll(() =>
      dialog.evaluate((el) => el.getAnimations().filter((a) => a.playState === "running").length),
    )
    .toBe(0);
  await layout(page, name, dialog);
  const box = await dialog.boundingBox();
  // Mobile Chromium can expose a fractional visual viewport at scale 1; clientWidth
  // rounds it to an integer even though fixed sheets fill the fractional viewport.
  const width = await page.evaluate(
    () => visualViewport?.width ?? document.documentElement.clientWidth,
  );
  expect.soft(box!.x, `${name}: left edge`).toBeGreaterThanOrEqual(0);
  expect.soft(box!.x + box!.width, `${name}: right edge`).toBeLessThanOrEqual(width);
  expect.soft(box!.y, `${name}: top edge`).toBeGreaterThanOrEqual(0);
  const body = dialog.locator('[data-slot="drawer-body"]');
  if (await body.count()) {
    expect
      .soft(await body.evaluate((el) => el.scrollWidth - el.clientWidth), `${name}: body width`)
      .toBe(0);
    const bodyBox = await body.boundingBox();
    expect
      .soft(bodyBox!.y + bodyBox!.height, `${name}: body bottom`)
      .toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
  }
  return dialog;
}

for (const viewport of [
  { width: 402, height: 874 },
  { width: 320, height: 568 },
  { width: 874, height: 402 },
]) {
  test.describe(`mobile layout ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    let fixture: Fixture;
    test.beforeEach(async ({ request }) => {
      fixture = await (await request.post(apiURL + "/_test/reset")).json();
    });

    test("pages and editable controls fit the viewport", async ({ page }) => {
      await page.goto("/login");
      await expect(page.getByLabel("Email or username", { exact: true })).toBeVisible();
      await layout(page, "Sign in");
      await login(page);
      for (const path of [
        "/",
        "/discover",
        "/activity",
        "/messages",
        `/messages/${fixture.conversationShortId}`,
        "/u/alice",
        "/u/bob",
        "/u/mia",
        "/settings",
        `/l/${fixture.links[0]!.shortId}`,
      ]) {
        await page.goto(path);
        await expect(page.locator(".app-content")).toBeVisible();
        await expect(page.locator(".loading-state")).toHaveCount(0);
        await layout(page, path);
      }
      await page.goto("/page-that-does-not-exist");
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await layout(page, "Not found");
    });

    test("registration, verification, correction and recovery fit", async ({ page }) => {
      await page.goto("/login");
      await page.getByRole("button", { name: "Forgot password?", exact: true }).click();
      await layout(page, "Password recovery");
      await page.goto("/login");
      await page.getByRole("button", { name: "Create an account", exact: true }).click();
      await layout(page, "Registration");
      await page.getByLabel("Name", { exact: true }).fill("Mobile reader");
      await page.getByLabel("Username", { exact: true }).fill("mobile_reader");
      await page.getByLabel("Email", { exact: true }).fill("mobile_reader@example.test");
      await page.getByLabel("Password", { exact: true }).fill("test-password-123");
      await page.getByRole("button", { name: "Create account", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Verify your email", exact: true }),
      ).toBeVisible();
      await layout(page, "Verification");
      await page.getByRole("button", { name: "Correct email address", exact: true }).click();
      await layout(page, "Email correction");
    });

    test("destination menu, group, week, post and recipient sheets fit", async ({ page }) => {
      await login(page);
      await page
        .locator('.week-page[data-active="true"]')
        .getByRole("button", { name: "Save destination: Your links" })
        .click();
      const menu = page.getByRole("menu");
      await expect
        .poll(async () => {
          const box = (await menu.boundingBox())!;
          return box.x >= 0 && box.x + box.width <= viewport.width;
        })
        .toBe(true);
      await page.screenshot({ path: `test-results/mobile-${viewport.width}-destination.png` });
      await menu.getByRole("menuitem", { name: "New group…", exact: true }).click();
      let dialog = await dialogLayout(page, "New group");
      if (viewport.width <= 700) await expect(dialog).toBeFocused();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /jump to a week/ }).click();
      await dialogLayout(page, "Weeks");
      await page.keyboard.press("Escape");
      await page.locator('.week-page[data-active="true"] .own-links .link-open').first().click();
      dialog = await dialogLayout(page, "Post");
      await dialog.getByRole("link", { name: "Edit", exact: true }).click();
      await dialogLayout(page, "Edit link");
      await page.goto("/messages");
      await page.getByRole("button", { name: "New message", exact: true }).click();
      await dialogLayout(page, "New message");
    });

    test("settings and nested profile and group sheets fit", async ({ page }) => {
      await login(page);
      await page.goto("/u/alice?settings=true");
      if (viewport.width <= 700) await dialogLayout(page, "Settings");
      else await page.goto("/settings");
      await page.getByRole("button", { name: "Edit profile", exact: true }).click();
      await dialogLayout(page, "Edit profile");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "New group", exact: true }).click();
      await dialogLayout(page, "New group");
    });

    test("connections, forwarding, duplicates, confirmations and security forms fit", async ({
      page,
    }) => {
      await login(page);
      await page.goto("/u/alice");
      await page.getByRole("button", { name: /followers?$/ }).click();
      await dialogLayout(page, "Connections");
      await page.keyboard.press("Escape");
      await page.goto("/");
      const current = page.locator('.week-page[data-active="true"]');
      const input = current.getByRole("textbox", { name: /Enter a link/ });
      await input.fill("https://pages.test/calm-software");
      await input.press("Enter");
      await expect(
        current.getByRole("button", { name: "Calm Software", exact: true }),
      ).toBeVisible();
      await input.fill("https://pages.test/calm-software");
      await input.press("Enter");
      // Touch has no Return to point at, so Save again is offered to tap.
      const saved = current.getByRole("status").filter({ hasText: "Already saved this week" });
      await expect(saved).toHaveText("Already saved this week · Save again · View");
      await layout(page, "Already saved");
      await saved.getByRole("button", { name: "Save again", exact: true }).click();
      await expect(saved).toHaveCount(0);
      await expect(current.getByRole("button", { name: "Calm Software", exact: true })).toHaveCount(
        2,
      );
      await current.locator(".own-links .link-open").first().click();
      const post = await dialogLayout(page, "Post");
      await post.getByRole("button", { name: "Forward", exact: true }).click();
      await dialogLayout(page, "Send link");
      await page.keyboard.press("Escape");
      await page.goto("/settings");
      await page.getByRole("button", { name: /Profile visibility:/ }).click();
      await page.getByRole("menuitemradio", { name: "Public", exact: true }).click();
      const confirm = page.getByRole("alertdialog", { name: "Make profile public?" });
      await expect(confirm).toBeVisible();
      await layout(page, "Privacy confirmation", confirm);
      await expect
        .poll(async () => {
          const box = await confirm.boundingBox();
          const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
          return (
            box!.x >= 0 &&
            box!.y >= 0 &&
            box!.x + box!.width <= size.width &&
            box!.y + box!.height <= size.height
          );
        })
        .toBe(true);
      await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Actions for Reading", exact: true }).click();
      await page.getByRole("menuitem", { name: "Edit group", exact: true }).click();
      await dialogLayout(page, "Edit group");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Change password", exact: true }).click();
      await layout(page, "Change password");
      await page.getByRole("button", { name: "Change email", exact: true }).click();
      await layout(page, "Change email");
    });
  });
}

test.describe("software keyboard layout", () => {
  test.use({
    viewport: { width: 402, height: 874 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  test("a reduced visual viewport keeps sheet fields and actions reachable", async ({
    page,
    request,
  }) => {
    await request.post(apiURL + "/_test/reset");
    await login(page);
    await page
      .locator('.week-page[data-active="true"]')
      .getByRole("button", { name: "Save destination: Your links" })
      .click();
    await page.getByRole("menuitem", { name: "New group…", exact: true }).click();
    const form = await dialogLayout(page, "New group");
    await expect(form).toBeFocused();
    // Desktop automation cannot open an iOS keyboard. Simulate its VisualViewport
    // geometry, exercising the real Base UI provider and our production sheet CSS.
    await page.evaluate(() => {
      Object.defineProperties(visualViewport!, {
        height: { configurable: true, get: () => innerHeight - 350 },
        offsetTop: { configurable: true, get: () => 0 },
        scale: { configurable: true, get: () => 1 },
      });
    });
    const name = form.getByRole("textbox", { name: "Name", exact: true });
    await name.focus();
    await page.evaluate(() => visualViewport!.dispatchEvent(new Event("resize")));
    await expect
      .poll(() => form.evaluate((el) => el.getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(524);
    await name.fill("Reading list");
    const create = form.getByRole("button", { name: "Create", exact: true });
    await create.scrollIntoViewIfNeeded();
    const action = await create.boundingBox();
    expect(action!.y + action!.height).toBeLessThanOrEqual(524);
    await page.screenshot({ path: "test-results/mobile-keyboard-new-group.png" });
    await page.keyboard.press("Escape");
    await expect(form).toHaveCount(0);
    await page.evaluate(() => {
      for (const key of ["height", "offsetTop", "scale"])
        Reflect.deleteProperty(visualViewport!, key);
      visualViewport!.dispatchEvent(new Event("resize"));
    });
    await layout(page, "After keyboard and sheet close");
    await expect(
      page
        .locator('.week-page[data-active="true"]')
        .getByRole("button", { name: "Save destination: Your links" }),
    ).toBeFocused();
  });
});
