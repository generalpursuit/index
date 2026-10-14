import { apiURL } from "./urls";
import { test, expect } from "@playwright/test";

let fixture: { week: string; older: string; people: Record<string, string> };
test.beforeEach(async ({ request }) => {
  fixture = await (await request.post(apiURL + "/_test/reset")).json();
});
async function login(page: import("@playwright/test").Page, person: string) {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill(person);
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}

test("empty week keeps the fixed zones with an invitation and contextual discovery", async ({
  page,
}) => {
  await login(page, "bob");
  const current = page.locator('.week-page[data-active="true"]');
  // The field is the invitation, and the only way to add a link.
  const field = current.getByRole("textbox", { name: /Enter a link to add it/ });
  await expect(field).toBeVisible();
  await expect(page.getByRole("link", { name: "Add link" })).toHaveCount(0);
  // Nobody followed yet: a person's place holds the invitation to find people.
  const placeholder = current.locator(".empty-box");
  await expect(placeholder).toContainText("Find people whose taste you trust");
  // Section names are for assistive technology only.
  await expect(current.getByRole("heading", { name: "Yours", exact: true })).toHaveCount(1);
  await expect(current.getByRole("heading", { name: "Your people", exact: true })).toHaveCount(1);
  await expect(current.getByRole("link", { name: "Discover people" })).toBeVisible();
  await expect(current.locator(".link-list[tabindex]")).toHaveCount(0);
  await expect(current.locator(".friend-card[data-peeking]")).toHaveCount(0);
  // Bob has no earlier weeks with links, so there is no other week to jump to.
  await expect(page.locator(".week-scrubber")).toHaveCount(0);
  // Zones are fixed: an empty week leaves room above the people, whose zone starts halfway.
  const own = await current.locator(".own-links").boundingBox();
  const invitation = await field.boundingBox();
  const people = await current.locator(".people").boundingBox();
  expect(invitation!.y - own!.y).toBeLessThan(40);
  expect(Math.abs(own!.height - people!.height)).toBeLessThan(2);
  await page.screenshot({ path: "test-results/empty-week-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  // Phones show the same field, at 16px so focusing it does not zoom the page.
  await expect(field).toBeVisible();
  expect(await field.evaluate((input) => getComputedStyle(input).fontSize)).toBe("16px");
  const friends = await placeholder.boundingBox();
  expect(friends!.y + friends!.height).toBeLessThan(780);
  await page.screenshot({ path: "test-results/empty-week-mobile.png" });
});

test("weeks change only through the scrubber or the week list, never by scrolling", async ({
  page,
}) => {
  await login(page, "alice");
  const pager = page.locator(".week-pager");
  const current = page.locator('.week-page[data-active="true"]');
  const ticks = page.locator(".week-tick");
  await expect(current.locator(".own-links")).toContainText("Are.na");
  await expect(ticks).toHaveCount(2);
  await expect(ticks.first()).toHaveAttribute("data-active", "true");
  // The box peeking in at the edge shows there are more people.
  const boxes = current.locator(".friends-carousel > .friend-card");
  await expect(boxes.nth(2)).toHaveAttribute("data-peeking");
  await expect(boxes.first()).not.toHaveAttribute("data-peeking");
  await pager.evaluate((element) => {
    (window as any).weekScrollPositions = [];
    element.addEventListener("scroll", () =>
      (window as any).weekScrollPositions.push(element.scrollTop),
    );
  });
  const height = await pager.evaluate((element) => element.clientHeight);
  // Scrolling past the end of a list, or over the page, leaves the week alone.
  for (const zone of [current.locator(".own-links .link-list"), current.locator(".people")]) {
    await zone.hover();
    await page.mouse.wheel(0, height);
  }
  await page.waitForTimeout(400);
  await expect(page).not.toHaveURL(/week=/);
  await expect(current.locator(".own-links")).toContainText("Are.na");
  // The next week's tick slides it into place.
  await ticks.nth(1).click();
  await expect(page).toHaveURL(new RegExp(fixture.older));
  await expect(ticks.nth(1)).toHaveAttribute("data-active", "true");
  const positions: number[] = await page.evaluate(() => (window as any).weekScrollPositions);
  expect(positions.some((top) => top > 5 && top < height - 5)).toBe(true);
  await expect(current.locator(".own-links")).toContainText("Earlier notes");
  await expect(current.getByText("Nothing shared this week", { exact: true })).toBeVisible();
  await expect(current.getByRole("link", { name: "Discover people" })).toHaveCount(0);
  await expect
    .poll(() => pager.evaluate((el) => Math.abs(el.scrollTop % el.clientHeight)))
    .toBeLessThan(2);
  // The week title opens every week as a list, for keyboards and screen readers.
  await page.getByRole("button", { name: /jump to a week/ }).click();
  await page
    .getByRole("dialog", { name: "Weeks" })
    .getByRole("button", { name: /Week/ })
    .first()
    .click();
  await expect(current.locator(".own-links")).toContainText("Are.na");
  // Clicking the peeking box brings it into view instead of opening what is half hidden in it
  // (here the person's avatar, which would otherwise open their profile).
  const before = page.url();
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  // Locator.click can scroll the whole card into view first, removing its peeking state.
  // Use the visible sliver, as an actual pointer does, after the week has settled.
  await expect
    .poll(() => pager.evaluate((el) => Math.abs(el.scrollTop % el.clientHeight)))
    .toBeLessThan(2);
  await expect(boxes.nth(2)).toHaveAttribute("data-peeking");
  const rightPeek = await boxes.nth(2).boundingBox();
  await page.mouse.click(rightPeek!.x + 30, rightPeek!.y + 30);
  await expect(page).toHaveURL(before);
  await expect(boxes.nth(2)).not.toHaveAttribute("data-peeking");
  await expect(boxes.first()).toHaveAttribute("data-peeking");
  // The box now peeking on the left leads back.
  const leftPeek = await boxes.first().boundingBox();
  await page.mouse.click(leftPeek!.x + leftPeek!.width - 20, leftPeek!.y + 60);
  await expect(boxes.first()).not.toHaveAttribute("data-peeking");
  await page.setViewportSize({ width: 390, height: 844 });
  const carousel = current.locator(".friends-carousel");
  await carousel.hover();
  const url = page.url();
  await page.mouse.wheel(250, 0);
  await expect.poll(() => carousel.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await expect(page).toHaveURL(url);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => pager.evaluate((el) => Math.abs(el.scrollTop % el.clientHeight)))
    .toBeLessThan(2);
});

test("your links scroll under the field, with fades instead of scrollbars", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  await login(page, "alice");
  const current = page.locator('.week-page[data-active="true"]');
  const field = current.getByRole("textbox", { name: /Enter a link to add it/ });
  const list = current.locator(".own-links .link-list");
  await expect(list).toContainText("Are.na");
  await expect(list).toHaveAttribute("tabindex", "0");
  await expect(list).not.toHaveAttribute("data-fade-start");
  await expect(list).toHaveAttribute("data-fade-end", "true");
  expect(await list.evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe("none");
  // Whole rows only: the first visible row sits right under the field at either end.
  const firstRowGap = () =>
    list.evaluate((el) => {
      const top = el.getBoundingClientRect().top;
      const rows = [...el.querySelectorAll(".link-row")].map((r) => r.getBoundingClientRect());
      return {
        wholeRows: el.clientHeight % rows[0]!.height,
        offset: Math.round(rows.find((r) => r.bottom > top + 1)!.top - top),
      };
    });
  expect(await firstRowGap()).toEqual({ wholeRows: 0, offset: 0 });
  const top = (await field.boundingBox())!.y;
  await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(list).toHaveAttribute("data-fade-start", "true");
  await expect(list).not.toHaveAttribute("data-fade-end");
  expect((await field.boundingBox())!.y).toBe(top);
  expect(await firstRowGap()).toEqual({ wholeRows: 0, offset: 0 });
  // Only the box peeking in fades; the boxes in view never do.
  const boxes = current.locator(".friends-carousel > .friend-card");
  await expect(boxes.nth(2)).toHaveAttribute("data-peeking");
  await expect(boxes.nth(0)).not.toHaveAttribute("data-peeking");
  await expect(boxes.nth(1)).not.toHaveAttribute("data-peeking");
});

test("a long week loads as you reach its end and shows links you add", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  await login(page, "alice");
  const current = page.locator('.week-page[data-active="true"]');
  const field = current.getByRole("textbox", { name: /Enter a link to add it/ });
  const list = current.locator(".own-links .link-list");
  const rows = list.locator(".link-row");
  await expect(rows).toHaveCount(5);
  for (let i = 1; i <= 15; i++) {
    await field.fill(`https://pages.test/extra-link-${i}`);
    await field.press("Enter");
    await expect(rows).toHaveCount(5 + i);
  }
  // Saving while scrolled to the end goes back to the top at once, before the page is read.
  await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await field.fill("https://pages.test/slow-read");
  await field.press("Enter");
  const pending = current.locator(".own-links").getByText("Fetching title…");
  await expect(pending).toBeVisible();
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(pending).toBeVisible();
  await expect(rows.first()).toContainText("Slow read");
  // Already at the top, a new link takes the first row without the list moving at all.
  await list.evaluate((el) => {
    (window as any).listPositions = [];
    el.addEventListener("scroll", () => (window as any).listPositions.push(el.scrollTop));
  });
  await field.fill("https://pages.test/extra-link-17");
  await field.press("Enter");
  await expect(rows).toHaveCount(22);
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  expect(await page.evaluate(() => (window as any).listPositions)).toEqual([]);
  // The feed brings the first 20; the rest arrive when the end comes near, without a button.
  await page.reload();
  // Reload restores the loaded pages rather than reducing the list to its first page.
  await expect(rows).toHaveCount(22);
  await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(rows).toHaveCount(22);
  await expect(list.getByRole("button", { name: "Load more" })).toHaveCount(0);
});

test("reduced motion keeps explicit week navigation usable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page, "alice");
  await page.locator(".week-tick").nth(1).click();
  await expect(page).toHaveURL(new RegExp(fixture.older));
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});

test("a row's mark favorites your links and stars others' without opening them", async ({
  page,
}) => {
  await login(page, "alice");
  const current = page.locator('.week-page[data-active="true"]');
  const favorite = current.getByRole("button", { name: "Favorite Are.na", exact: true });
  const square = favorite.locator(".category-mark"),
    heart = favorite.locator("svg");
  // The heart takes the color of the square it replaces.
  const filledInCategoryColor = () =>
    favorite.evaluate((button) => {
      const svg = getComputedStyle(button.querySelector("svg")!),
        square = getComputedStyle(button.querySelector(".category-mark")!);
      return svg.fill === svg.color && svg.color === square.backgroundColor;
    });
  await expect(favorite).toHaveAttribute("aria-pressed", "false");
  await expect(square).toHaveCSS("opacity", "1");
  await expect(heart).toHaveCSS("opacity", "0");
  await expect(heart).toHaveCSS("transition-duration", /0\.15s/);
  // Pointing at the square shows the outline heart.
  await favorite.hover();
  await expect(heart).toHaveCSS("opacity", "1");
  await expect(square).toHaveCSS("opacity", "0");
  await expect(heart).toHaveCSS("fill", "rgba(0, 0, 0, 0)");
  // The whole mark column is the target, and keeping a link does not open it.
  const column = (await favorite.boundingBox())!;
  expect(column.width).toBe(32);
  expect(column.height).toBeGreaterThanOrEqual(46);
  await page.mouse.click(column.x + 2, column.y + 2);
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  await expect.poll(filledInCategoryColor).toBe(true);
  await page.mouse.move(0, 0);
  await expect(heart).toHaveCSS("opacity", "1");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).not.toHaveURL(/post=/);
  // Other people's links are starred instead (in a card in view; one peeking in scrolls).
  const star = current
    .locator(".friend-card")
    .first()
    .getByRole("button", { name: /^Star / })
    .first();
  const starred = (await star.getAttribute("aria-label"))!;
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  // Keyboard focus shows the heart too, and Space keeps the link.
  await current.getByRole("button", { name: "In Rainbows", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  const rainbows = current.getByRole("button", { name: "Favorite In Rainbows", exact: true });
  await expect(rainbows).toBeFocused();
  await expect(rainbows.locator("svg")).toHaveCSS("opacity", "1");
  await page.keyboard.press("Space");
  await expect(rainbows).toHaveAttribute("aria-pressed", "true");
  // Every list shows what you keep, and lets it go from there.
  await page.getByRole("link", { name: "Your profile", exact: true }).click();
  const lists = page.getByRole("navigation", { name: "Lists" });
  await lists.getByRole("link", { name: "Favorites", exact: true }).click();
  const profile = page.locator(".profile-links");
  await expect(
    profile.getByRole("button", { name: "Favorite Are.na", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const kept = profile.getByRole("button", { name: "Favorite In Rainbows", exact: true });
  await expect(kept).toHaveAttribute("aria-pressed", "true");
  await kept.click();
  await expect(kept).toHaveCount(0);
  await lists.getByRole("link", { name: "Starred", exact: true }).click();
  await expect(profile.getByRole("button", { name: starred, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The post's heart is the same toggle.
  await lists.getByRole("link", { name: "Favorites", exact: true }).click();
  await profile.getByRole("button", { name: "Are.na", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Post", exact: true })
      .getByRole("button", { name: "Favorite", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // Reduced motion swaps square and heart without the fade.
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    profile.getByRole("button", { name: "Favorite Are.na", exact: true }).locator("svg"),
  ).toHaveCSS("transition-duration", "0s");
});

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`week heading stays fixed during paging at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await login(page, "alice");
    const heading = page.getByRole("heading", { level: 1 });
    const title = await heading.textContent();
    const pager = page.locator(".week-pager");
    await pager.evaluate((element) => {
      const heading = document.querySelector("h1")!;
      (window as any).headingPositions = [heading.getBoundingClientRect().top];
      element.addEventListener("scroll", () => {
        (window as any).headingPositions.push(heading.getBoundingClientRect().top);
      });
    });
    await page.locator(".week-tick").nth(1).click();
    await expect(page).toHaveURL(new RegExp(fixture.older));
    const positions: number[] = await page.evaluate(() => (window as any).headingPositions);
    expect(positions.length).toBeGreaterThan(2);
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1);
    await expect(heading).toHaveText(/^Week \d+$/);
    await expect(heading).not.toHaveText(title!);
    await expect(page.locator(".week-label")).toHaveCount(0);
  });
}
