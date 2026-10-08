import { test, expect } from "@playwright/test";

let fixture: { week: string; older: string; people: Record<string, string> };
test.beforeEach(async ({ request }) => {
  fixture = await (await request.post("http://localhost:3002/_test/reset")).json();
});
async function login(page: import("@playwright/test").Page, person: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(person + "@test.example");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}

test("empty week has a compact invitation and contextual discovery", async ({ page }) => {
  await login(page, "bob");
  const current = page.locator('.week-page[data-active="true"]');
  await expect(
    current.getByRole("heading", { name: "What caught your eye this week?" }),
  ).toBeVisible();
  await expect(current.getByRole("link", { name: "Discover people" })).toBeVisible();
  await expect(current.locator(".link-list[tabindex]")).toHaveCount(0);
  await expect(current.getByRole("button", { name: "Next person" })).toHaveCount(0);
  const own = await current.locator(".own-links").boundingBox();
  expect(own!.height).toBeLessThan(300);
  await page.screenshot({ path: "test-results/empty-week-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(current.getByRole("link", { name: "Add a link", exact: true })).toBeVisible();
  const friends = await current.locator(".week-empty-friends").boundingBox();
  expect(friends!.y + friends!.height).toBeLessThan(780);
  await page.screenshot({ path: "test-results/empty-week-mobile.png" });
  await current.getByRole("link", { name: "Add a link", exact: true }).click();
  await expect(page).toHaveURL(/\/add\?/);
  await expect(page.getByRole("heading", { name: "Add link" })).toBeVisible();
});

test("scroll moves between weeks before settling, without changing horizontal browsing", async ({
  page,
}) => {
  await login(page, "alice");
  const pager = page.locator(".week-pager");
  const current = page.locator('.week-page[data-active="true"]');
  await expect(current.locator(".own-links")).toContainText("Are.na");
  await pager.evaluate((element) => {
    (window as any).weekScrollPositions = [];
    element.addEventListener("scroll", () =>
      (window as any).weekScrollPositions.push(element.scrollTop),
    );
  });
  const height = await pager.evaluate((element) => element.clientHeight);
  await current.getByRole("heading", { level: 1 }).hover();
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
