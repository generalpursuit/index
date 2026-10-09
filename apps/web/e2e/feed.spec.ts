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

test("empty week has a compact invitation and contextual discovery", async ({ page }) => {
  await login(page, "bob");
  const current = page.locator('.week-page[data-active="true"]');
  await expect(current.getByText("What caught your eye this week?")).toBeVisible();
  // Section names are for assistive technology only.
  await expect(current.getByRole("heading", { name: "Yours", exact: true })).toHaveCount(1);
  await expect(current.getByRole("heading", { name: "Your people", exact: true })).toHaveCount(1);
  await expect(current.getByRole("link", { name: "Discover people" })).toBeVisible();
  await expect(current.locator(".link-list[tabindex]")).toHaveCount(0);
  await expect(current.getByRole("button", { name: "Next person" })).toHaveCount(0);
  // Bob has no earlier weeks with links, so there is nowhere older to go.
  await expect(page.getByRole("button", { name: "Older week" })).toHaveCount(0);
  const own = await current.locator(".own-links").boundingBox();
  expect(own!.height).toBeLessThan(300);
  await page.screenshot({ path: "test-results/empty-week-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(current.getByRole("link", { name: "Add a link", exact: true })).toBeVisible();
  const friends = await current.locator(".friends-carousel .week-empty").boundingBox();
  expect(friends!.y + friends!.height).toBeLessThan(780);
  await page.screenshot({ path: "test-results/empty-week-mobile.png" });
  await current.getByRole("link", { name: "Add a link", exact: true }).click();
  // Adding opens over the current page instead of navigating away.
  await expect(page).toHaveURL(/add=true/);
  await expect(page.getByRole("heading", { name: "Add link" })).toBeVisible();
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
  await expect(current.getByText("Nothing shared this week yet.")).toBeVisible();
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
