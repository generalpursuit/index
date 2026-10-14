import { test, expect, type Page } from "@playwright/test";
import { apiURL } from "./urls";
let fixture: {
  week: string;
  conversationId: string;
  links: { id: string; shortId: string; title: string }[];
  privateLink: { id: string; title: string };
};
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

test("warm main pages show their content while every refresh is delayed", async ({ page }) => {
  await login(page);
  const pages = [
    ["Discover", ".people-list"],
    ["Activity", ".activity-list"],
    ["Messages", ".conversation-list"],
    ["Your profile", ".profile-heading"],
    ["Settings", ".settings-content"],
  ] as const;
  for (const [name, selector] of pages) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page.locator(selector)).toBeVisible();
  }
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/v1/**", async (route) => {
    await waiting;
    await route.continue();
  });
  try {
    for (const [name, selector] of pages) {
      await page.getByRole("link", { name, exact: true }).click();
      await expect(page.locator(selector)).toBeVisible({ timeout: 1500 });
      await expect(page.locator('[aria-label="Loading"], .loader, [data-placeholder]')).toHaveCount(
        0,
      );
    }
  } finally {
    release();
  }
});

test("disk content renders on reload before the network answers and keeps its position", async ({
  page,
}) => {
  await login(page);
  await page.waitForTimeout(1300);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let answered = 0;
  await page.route("**/rpc/v1/**", async (route) => {
    await waiting;
    answered++;
    await route.continue();
  });
  await page.route("**/api/auth/get-session**", async (route) => {
    await waiting;
    answered++;
    await route.continue();
  });
  await page.addInitScript(() => {
    (window as unknown as { shifts: number[] }).shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput)
          (window as unknown as { shifts: number[] }).shifts.push(shift.value);
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  try {
    await page.reload();
    const rows = page.locator('.week-page[data-active="true"] .own-links');
    await expect(rows).toContainText("Are.na", { timeout: 1500 });
    expect(answered).toBe(0);
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    const before = await rows.boundingBox();
    await page.evaluate(() => {
      (window as unknown as { shifts: number[] }).shifts = [];
    });
    release();
    await page.waitForTimeout(1000);
    expect(await rows.boundingBox()).toEqual(before);
    expect(await page.evaluate(() => (window as unknown as { shifts: number[] }).shifts)).toEqual(
      [],
    );
  } finally {
    release();
  }
});

test("warm home renders without another blocking read", async ({ page }) => {
  let cold = 0,
    warm = 0;
  let returning = false;
  page.on("request", (request) => {
    if (
      request.url().includes("/rpc/v1/") &&
      (request.postDataJSON()?.json?.weekStart === fixture.week ||
        (Array.isArray(request.postDataJSON()) &&
          request
            .postDataJSON()
            .some(
              (item: { url: string; body?: { json?: { weekStart?: string } } }) =>
                new URL(item.url).pathname === "/rpc/v1/feed/week" &&
                item.body?.json?.weekStart === fixture.week,
            )))
    ) {
      if (returning) warm++;
      else cold++;
    }
  });
  await login(page);
  expect(cold).toBe(1);
  await page.getByRole("link", { name: "Discover", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  returning = true;
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator('.week-page[data-active="true"] .own-links')).toContainText("Are.na");
  expect(warm).toBe(0);
});

test("sending and a failed send update the bubble before either server answer", async ({
  page,
}) => {
  await login(page);
  await page.goto("/messages/" + fixture.conversationId);
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let answered = false;
  await page.route("**/rpc/v1/messages/send**", async (route) => {
    await waiting;
    answered = true;
    await route.abort("failed");
  });
  const text = "This optimistic message has not reached the server";
  try {
    await page.getByLabel("Message", { exact: true }).fill(text);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.locator(".message-bubble").last()).toHaveText(text, { timeout: 1500 });
    expect(answered).toBe(false);
    await expect(page.locator('.message[data-delivery="pending"]')).toContainText("Sending");
  } finally {
    release();
  }
  await expect(page.locator(".message-bubble").filter({ hasText: text })).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("Delivery is unconfirmed");
});

test("a comment appears before its server answer and rolls back on failure", async ({ page }) => {
  await login(page);
  await page
    .locator('.week-page[data-active="true"] .own-links')
    .getByRole("button", { name: "Are.na", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Post", exact: true });
  await expect(dialog.locator(".comments")).toContainText("Do you have a favorite channel?");
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let answered = false;
  await page.route("**/rpc/v1/comments/create**", async (route) => {
    await waiting;
    answered = true;
    await route.abort("failed");
  });
  const text = "This comment is still on its way";
  try {
    await dialog.getByRole("textbox").fill(text);
    await dialog.getByRole("button", { name: "Post comment", exact: true }).click();
    await expect(dialog.locator(".comment").filter({ hasText: text })).toHaveCount(1, {
      timeout: 1500,
    });
    expect(answered).toBe(false);
  } finally {
    release();
  }
  await expect(dialog.locator(".comment").filter({ hasText: text })).toHaveCount(0);
  await expect(dialog.getByRole("textbox")).toHaveValue(text);
});

test("following changes its control before the server answers and rolls back on failure", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "Discover", exact: true }).click();
  await expect(page.locator(".people-list")).toBeVisible();
  const button = page.locator(".person-row").first().locator("button");
  await expect(button).toHaveAccessibleName("Request");
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let answered = false;
  await page.route("**/rpc/v1/follows/follow**", async (route) => {
    await waiting;
    answered = true;
    await route.abort("failed");
  });
  try {
    await button.click();
    await expect(button).toHaveAccessibleName("Requested", { timeout: 1500 });
    expect(answered).toBe(false);
  } finally {
    release();
  }
  await expect(button).toBeEnabled();
  await expect(button).toHaveAccessibleName("Request");
});

test("a conversation reopens with its cached messages while the network is held", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "Messages", exact: true }).click();
  const row = page.locator(".conversation-row").first();
  const path = await row.getAttribute("href");
  await row.click();
  await expect(page.locator(".message-bubble")).not.toHaveCount(0);
  const text = await page.locator(".message-bubble").first().innerText();
  await page.getByRole("link", { name: "Discover", exact: true }).click();
  await expect(page.locator(".people-list")).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/v1/**", async (route) => {
    await held;
    await route.continue();
  });
  try {
    await page.getByRole("link", { name: "Messages", exact: true }).click();
    await page.locator(`.conversation-row[href="${path}"]`).click();
    await expect(page.locator(".message-bubble").first()).toHaveText(text, { timeout: 1500 });
    await expect(page.locator('[aria-label="Loading"], [data-placeholder]')).toHaveCount(0);
  } finally {
    release();
  }
});

test("unfollowing a private person hides a previously cached post on return", async ({ page }) => {
  await login(page);
  await page.goto("/links/" + fixture.privateLink.id);
  await expect(
    page.getByRole("heading", { name: fixture.privateLink.title, exact: true }),
  ).toBeVisible();
  await page.locator(".post-author .person-inline").click();
  await expect(page.getByRole("button", { name: "Following", exact: true })).toBeEnabled();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let answered = false;
  await page.route("**/rpc/v1/follows/unfollow**", async (route) => {
    await held;
    answered = true;
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Following", exact: true }).click();
    await expect(page.getByText("Only Iris’s followers can view their posts.")).toBeVisible();
    expect(answered).toBe(false);
  } finally {
    release();
  }
  await expect(page.getByRole("button", { name: "Request", exact: true })).toBeEnabled();
  await page.goBack();
  await expect(page).toHaveURL(/\/l\//);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: fixture.privateLink.title, exact: true }),
  ).toHaveCount(0);
});
