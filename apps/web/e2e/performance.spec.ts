import { test, expect, type Page } from "@playwright/test";
import { apiURL } from "./urls";
let fixture: { links: { id: string; title: string }[]; older: string };
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice@test.example");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator('.week-page[data-active="true"] .own-links')).toContainText("Are.na");
}
test.beforeEach(async ({ request }) => {
  fixture = await (await request.post(apiURL + "/_test/reset")).json();
});
test("a visible post opens with content while its detail refresh is still pending", async ({
  page,
}) => {
  await login(page);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/v1/links/get**", async (route) => {
    await blocked;
    await route.continue();
  });
  let commentsStarted = false;
  page.on("request", (request) => {
    if (request.url().includes("/rpc/v1/comments/list")) commentsStarted = true;
  });
  try {
    await page
      .locator('.week-page[data-active="true"] .own-links')
      .getByRole("button", { name: "Are.na", exact: true })
      .click();
    const post = page.getByRole("dialog", { name: "Post", exact: true });
    await expect(post.getByRole("heading", { name: "Are.na", exact: true })).toBeVisible({
      timeout: 1500,
    });
    await expect.poll(() => commentsStarted, { timeout: 1500 }).toBe(true);
    await expect(post.locator(".comments")).toContainText("Do you have a favorite channel?");
  } finally {
    release();
  }
});
test("Discover preloads its data on navigation intent", async ({ page }) => {
  await login(page);
  let recommendations = 0;
  page.on("request", (request) => {
    if (request.url().includes("/rpc/v1/discovery/recommendations")) recommendations++;
  });
  await page.getByRole("link", { name: "Discover", exact: true }).hover();
  await expect.poll(() => recommendations, { timeout: 1500 }).toBe(1);
  await page.getByRole("link", { name: "Discover", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  expect(recommendations).toBe(1);
});
test("a profile renders its first weeks while the rest of the index is pending", async ({
  page,
}) => {
  await login(page);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route("**/rpc/v1/links/weeks**", async (route) => {
    requests++;
    if (requests > 1) {
      await blocked;
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = await response.json();
    body.json.nextBefore = fixture.older;
    await route.fulfill({ response, json: body });
  });
  try {
    await page.getByRole("link", { name: "Your profile", exact: true }).click();
    await expect.poll(() => requests).toBeGreaterThan(1);
    await expect(
      page.locator(".profile-links").getByRole("button", { name: "Are.na", exact: true }),
    ).toBeVisible({ timeout: 1500 });
  } finally {
    release();
  }
});
test("Discover follow buttons do not fetch every person's full profile", async ({ page }) => {
  await login(page);
  let profiles = 0;
  page.on("request", (request) => {
    if (request.url().includes("/rpc/v1/profiles/get")) profiles++;
  });
  await page.getByRole("link", { name: "Discover", exact: true }).click();
  await page.getByLabel("Search people").fill("a");
  await expect(page.locator(".people-list .person-row")).not.toHaveCount(0);
  await expect(page.locator(".people-list .person-row button").first()).toBeEnabled();
  expect(profiles).toBe(0);
});

test("a failed background refresh keeps the known post readable", async ({ page }) => {
  await login(page);
  await page.route("**/rpc/v1/links/get**", (route) => route.abort("failed"));
  await page
    .locator('.week-page[data-active="true"] .own-links')
    .getByRole("button", { name: "Are.na", exact: true })
    .click();
  const post = page.getByRole("dialog", { name: "Post", exact: true });
  await expect(post.getByRole("heading", { name: "Are.na", exact: true })).toBeVisible();
  await expect(post).toContainText("Couldn’t refresh. Showing saved content.");
  await expect(post.getByRole("heading", { name: "Are.na", exact: true })).toBeVisible();
});

test("Favorites update immediately and roll back when the write fails", async ({ page }) => {
  await login(page);
  await page
    .locator('.week-page[data-active="true"] .own-links')
    .getByRole("button", { name: "Are.na", exact: true })
    .click();
  const post = page.getByRole("dialog", { name: "Post", exact: true });
  const actions = post.getByRole("button", { name: "Actions for Are.na", exact: true });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/v1/favorites/add**", async (route) => {
    await blocked;
    await route.abort("failed");
  });
  try {
    await actions.click();
    await page.getByRole("menuitem", { name: "Add to Favorites", exact: true }).click();
    await actions.click();
    await expect(
      page.getByRole("menuitem", { name: "Remove from Favorites", exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByRole("menuitem", { name: "Add to Favorites", exact: true })).toBeEnabled();
});
