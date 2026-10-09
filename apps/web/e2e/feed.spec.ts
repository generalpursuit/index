import { test, expect } from "@playwright/test";

let fixture: { week: string; older: string; people: Record<string, string> };
test.beforeEach(async ({ request }) => {
  fixture = await (await request.post("http://localhost:3002/_test/reset")).json();
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
  await expect(current.getByRole("button", { name: "Next person" })).toHaveCount(0);
  // Bob has no earlier weeks with links, so there is nowhere older to go.
  await expect(page.getByRole("button", { name: "Older week" })).toHaveCount(0);
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

test("scroll moves between weeks before settling, without changing horizontal browsing", async ({
  page,
}) => {
  await login(page, "alice");
  const pager = page.locator(".week-pager");
  const current = page.locator('.week-page[data-active="true"]');
  await expect(current.locator(".own-links")).toContainText("Are.na");
  // Controls only appear when there is somewhere to go.
  await expect(page.getByRole("button", { name: "Newer week" })).toHaveCount(0);
  await expect(current.getByRole("button", { name: "Previous person" })).toHaveCount(0);
  await expect(current.getByRole("button", { name: "Next person" })).toBeVisible();
  await pager.evaluate((element) => {
    (window as any).weekScrollPositions = [];
    element.addEventListener("scroll", () =>
      (window as any).weekScrollPositions.push(element.scrollTop),
    );
  });
  const height = await pager.evaluate((element) => element.clientHeight);
  await current.locator(".people").hover();
  await page.mouse.wheel(0, height * 0.75);
  await expect(page).toHaveURL(new RegExp(fixture.older));
  const positions: number[] = await page.evaluate(() => (window as any).weekScrollPositions);
  expect(positions.some((top) => top > 5 && top < height - 5)).toBe(true);
  await expect(current.locator(".own-links")).toContainText("Earlier notes");
  await expect(current.getByText("Nothing shared this week", { exact: true })).toBeVisible();
  await expect(current.getByRole("link", { name: "Discover people" })).toHaveCount(0);
  await expect
    .poll(() => pager.evaluate((el) => Math.abs(el.scrollTop % el.clientHeight)))
    .toBeLessThan(2);
  await page.getByRole("button", { name: "Newer week" }).click();
  await expect(current.locator(".own-links")).toContainText("Are.na");
  await current.getByRole("button", { name: "Next person" }).click();
  await expect(current.getByRole("button", { name: "Previous person" })).toBeVisible();
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
  // Only the box peeking in fades; the boxes in view never do. The arrows sit on the edges,
  // level with the people's names.
  const carousel = current.locator(".friends-carousel");
  const boxes = carousel.locator(".friend-card");
  await expect(boxes.nth(2)).toHaveAttribute("data-peeking");
  await expect(boxes.nth(0)).not.toHaveAttribute("data-peeking");
  await expect(boxes.nth(1)).not.toHaveAttribute("data-peeking");
  const next = (await current.getByRole("button", { name: "Next person" }).boundingBox())!;
  const area = (await carousel.boundingBox())!;
  const name = (await carousel.locator(".person-inline").first().boundingBox())!;
  expect(Math.round(next.x + next.width)).toBe(Math.round(area.x + area.width));
  expect(Math.abs(next.y + next.height / 2 - (name.y + name.height / 2))).toBeLessThan(2);
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
  await expect(rows).toHaveCount(20);
  await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(rows).toHaveCount(22);
  await expect(list.getByRole("button", { name: "Load more" })).toHaveCount(0);
});

test("reduced motion keeps explicit week navigation usable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page, "alice");
  await page.getByRole("button", { name: "Older week" }).click();
  await expect(page).toHaveURL(new RegExp(fixture.older));
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
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
    await page.getByRole("button", { name: "Older week" }).click();
    await expect(page).toHaveURL(new RegExp(fixture.older));
    const positions: number[] = await page.evaluate(() => (window as any).headingPositions);
    expect(positions.length).toBeGreaterThan(2);
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1);
    await expect(heading).toHaveText(/^Week \d+$/);
    await expect(heading).not.toHaveText(title!);
    await expect(page.locator(".week-label")).toHaveCount(0);
  });
}
