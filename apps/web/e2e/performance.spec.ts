import { test, expect, type Page } from "@playwright/test";
import { apiURL } from "./urls";
let fixture: { links: { id: string; shortId: string; title: string }[]; older: string };
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
test("Discover's data loads once, before it opens", async ({ page }) => {
  // Counted from the start: an idle warm-up after login may load it before the hover does.
  let recommendations = 0;
  page.on("request", (request) => {
    if (request.url().includes("/rpc/v1/discovery/recommendations")) recommendations++;
  });
  await login(page);
  await page.getByRole("link", { name: "Discover", exact: true }).hover();
  await expect.poll(() => recommendations, { timeout: 1500 }).toBe(1);
  await page.getByRole("link", { name: "Discover", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  expect(recommendations).toBe(1);
});
test("a profile renders its first weeks while the rest of the index is pending", async ({
  page,
}) => {
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
  // Routed before login: an idle warm-up may load the first weeks before the click does.
  await login(page);
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
test("the current page keeps its layout until the next page is ready", async ({ page }) => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/v1/discovery/recommendations**", async (route) => {
    await blocked;
    await route.continue();
  });
  await login(page);
  try {
    await page.getByRole("link", { name: "Discover", exact: true }).click();
    await expect(page).toHaveURL(/\/discover$/);
    // The feed is still on screen, so it keeps the feed's full-height layout.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
    await expect(page.locator("#app-content")).toHaveClass(/feed-main/);
  } finally {
    release();
  }
  await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  await expect(page.locator("#app-content")).not.toHaveClass(/feed-main/);
});
test("a post opens at its full width", async ({ page }) => {
  await login(page);
  await page
    .locator('.week-page[data-active="true"] .own-links')
    .getByRole("button", { name: "Are.na", exact: true })
    .click();
  const post = page.getByRole("dialog", { name: "Post", exact: true });
  await expect(post.getByRole("heading", { name: "Are.na", exact: true })).toBeVisible();
  expect(await post.evaluate((element) => (element as HTMLElement).offsetWidth)).toBe(650);
});
test("editing a post keeps its dialog in place", async ({ page }) => {
  await login(page);
  await page
    .locator('.week-page[data-active="true"] .own-links')
    .getByRole("button", { name: "Are.na", exact: true })
    .click();
  const post = page.getByRole("dialog", { name: "Post", exact: true });
  await expect(post.getByRole("heading", { name: "Are.na", exact: true })).toBeVisible();
  // Measured once it has finished opening.
  await expect
    .poll(() => post.evaluate((element) => element.getAnimations({ subtree: true }).length))
    .toBe(0);
  const before = (await post.boundingBox())!;
  await post.evaluate((element) => element.setAttribute("data-opened-as", "Post"));
  await post.getByRole("link", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit link", exact: true });
  // The same dialog, rather than one closing as another opens.
  await expect(editor).toHaveAttribute("data-opened-as", "Post");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  const after = (await editor.boundingBox())!;
  expect([after.x, after.y, after.width]).toEqual([before.x, before.y, before.width]);
});
test("a post opened before its comments have loaded waits for them, then opens complete", async ({
  page,
}) => {
  await login(page);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/v1/comments/list**", async (route) => {
    await blocked;
    await route.continue();
  });
  const post = page.getByRole("dialog", { name: "Post", exact: true });
  try {
    await page
      .locator('.week-page[data-active="true"] .own-links')
      .getByRole("button", { name: "In Rainbows", exact: true })
      .click();
    // The page stays, under the progress bar, rather than showing the post without them.
    await expect(page.locator(".navigation-progress")).toBeAttached();
    await expect(post).toHaveCount(0);
  } finally {
    release();
  }
  await expect(post.locator(".comments")).toContainText("No comments yet.");
});
test("a post opened from its address shows complete from its first frame", async ({ page }) => {
  await login(page);
  type Frame = { post: boolean; loading: boolean; label: string };
  // Every frame the dialog is on screen.
  await page.addInitScript(() => {
    const frames: Frame[] = [];
    (window as unknown as { postFrames: Frame[] }).postFrames = frames;
    const sample = () => {
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog)
        frames.push({
          post: !!dialog.querySelector(".post-detail"),
          loading: !!dialog.querySelector('[role="status"]'),
          label: dialog.querySelector(".post-label")?.textContent ?? "",
        });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto("/?post=" + fixture.links[0]!.shortId);
  const post = page.getByRole("dialog", { name: "Post", exact: true });
  await expect(post.locator(".comments")).toContainText("Do you have a favorite channel?");
  const frames = await page.evaluate(
    () => (window as unknown as { postFrames: Frame[] }).postFrames,
  );
  expect(frames.length).toBeGreaterThan(0);
  // No empty or loading frame, and the group in its label from the start.
  expect(frames.filter((f) => !f.post || f.loading || !f.label.includes("Reading"))).toEqual([]);
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
  const favorite = post.getByRole("button", { name: "Favorite", exact: true });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/v1/favorites/add**", async (route) => {
    await blocked;
    await route.abort("failed");
  });
  try {
    await favorite.click();
    await expect(favorite).toHaveAttribute("aria-pressed", "true");
  } finally {
    release();
  }
  await expect(favorite).toHaveAttribute("aria-pressed", "false");
  await expect(favorite).toBeEnabled();
});

test("a row's mark keeps at once, waits for that result, and rolls back when it fails", async ({
  page,
}) => {
  await login(page);
  const own = page.locator('.week-page[data-active="true"] .own-links');
  const favorite = own.getByRole("button", { name: "Favorite Are.na", exact: true });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  await page.route("**/rpc/v1/favorites/**", async (route) => {
    writes++;
    await blocked;
    await route.abort("failed");
  });
  try {
    await favorite.click();
    await expect(favorite).toHaveAttribute("aria-pressed", "true");
    // The next change is decided from this one's result, so it waits.
    await favorite.click();
    await expect(favorite).toHaveAttribute("aria-pressed", "true");
    // The post shows the same change while it is on its way.
    await own.getByRole("button", { name: "Are.na", exact: true }).click();
    await expect(
      page
        .getByRole("dialog", { name: "Post", exact: true })
        .getByRole("button", { name: "Favorite", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
  } finally {
    release();
  }
  await expect(favorite).toHaveAttribute("aria-pressed", "false");
  expect(writes).toBe(1);
});
