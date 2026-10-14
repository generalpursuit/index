import { test, expect, type Page } from "@playwright/test";
import { apiURL } from "./urls";
import { routeRPC, rpcPaths } from "./rpc";
import { DesktopHarness } from "./desktop-harness";
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
  await expect(page.getByRole("alert")).toContainText(/not.?found|forbidden|unavailable/i);
  await expect(
    page.getByRole("heading", { name: fixture.privateLink.title, exact: true }),
  ).toHaveCount(0);
});

test("disabled IndexedDB still permits sign-in, sign-out and a second account", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      value: {
        open: () => {
          throw new DOMException("Storage disabled", "SecurityError");
        },
      },
    });
  });
  await login(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await page.getByLabel("Email or username", { exact: true }).fill("bob@test.example");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator('.week-page[data-active="true"] .own-links')).not.toContainText(
    "Are.na",
  );
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
});

test("a seeded post checks access and hides a forbidden server response", async ({ page }) => {
  await routeRPC(page, "**/rpc/v1/links/get**", (route) =>
    route.fulfill({
      status: 404,
      json: {
        json: {
          defined: false,
          status: 404,
          code: "NOT_FOUND",
          message: "This post is no longer available",
        },
      },
    }),
  );
  await login(page);
  await page
    .locator('.week-page[data-active="true"] .own-links')
    .getByRole("button", { name: "Are.na", exact: true })
    .click();
  const post = page.getByRole("dialog", { name: "Post", exact: true });
  await expect(post.getByRole("alert")).toContainText("This post is no longer available");
  await expect(post.getByRole("heading", { name: "Are.na", exact: true })).toHaveCount(0);
});

test("a failing profile week keeps the page and offers a local retry", async ({ page }) => {
  await routeRPC(page, "**/rpc/v1/links/listByOwner**", (route) =>
    route.fulfill({
      status: 404,
      json: {
        json: {
          defined: false,
          status: 404,
          code: "NOT_FOUND",
          message: "Could not load this week",
        },
      },
    }),
  );
  await login(page);
  await page.goto("/u/alice");
  await expect(page.locator(".profile-heading")).toContainText("Alice");
  await expect(page.locator(".profile-week").getByRole("alert").first()).toContainText(
    "Could not load this week",
  );
  await expect(
    page.locator(".profile-week").getByRole("button", { name: "Try again" }).first(),
  ).toBeVisible();
});

test("a link draft completes after the editor has unmounted", async ({ page }) => {
  await login(page);
  await page
    .locator('.week-page[data-active="true"] .own-links')
    .getByRole("button", { name: "Are.na", exact: true })
    .click();
  const post = page.getByRole("dialog", { name: "Post", exact: true });
  await post.getByRole("link", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit link", exact: true });
  await editor.getByLabel("Title", { exact: true }).fill("A saved title   ");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/v1/links/update**", async (route) => {
    await held;
    await route.continue();
  });
  try {
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.waitForTimeout(600);
  } finally {
    release();
  }
  await expect(page.getByText("Link saved", { exact: true })).toBeVisible();
  await post.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(editor.getByLabel("Title", { exact: true })).toHaveValue("A saved title");
});

test("navigation preserves the legacy pulse driver after one unsupported endpoint probe", async ({
  page,
}) => {
  let probes = 0;
  await routeRPC(page, "**/rpc/v1/pulse/get**", async (route) => {
    probes++;
    await route.fulfill({
      status: 404,
      json: { json: { defined: false, status: 404, code: "NOT_FOUND", message: "Unsupported" } },
    });
  });
  await login(page);
  await expect.poll(() => probes).toBe(1);
  for (const name of ["Messages", "Discover", "Activity", "Home"]) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(1);
  }
  expect(probes).toBe(1);
});

test("a pending conversation uses its row's identity inside one app shell", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Messages", exact: true }).click();
  const row = page.locator(".conversation-row").first();
  const name = await row.locator("strong").innerText();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await routeRPC(page, "**/rpc/v1/messages/list**", async (route) => {
    await held;
    await route.continue();
  });
  try {
    await row.click();
    await expect(page.locator(".chat-heading strong")).toHaveText(name);
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(1);
  } finally {
    release();
  }
  await expect(page.locator('.chat-page [aria-label="Loading"]')).toHaveCount(0);
});

test("a confirmed message keeps its height through the next pulse", async ({ page }) => {
  await login(page);
  await page.goto("/messages/" + fixture.conversationId);
  await page.getByLabel("Message", { exact: true }).fill("A stable confirmed bubble");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const message = page.locator(".message").filter({ hasText: "A stable confirmed bubble" });
  await expect(message).not.toHaveAttribute("data-delivery", "pending");
  const height = await message.evaluate((element) => element.getBoundingClientRect().height);
  let reads = 0;
  page.on("request", (request) => {
    if (rpcPaths(request).includes("/rpc/v1/messages/list")) reads++;
  });
  await page.request.post(apiURL + "/rpc/v1/messages/send", {
    data: {
      json: {
        conversationId: fixture.conversationId,
        clientId: crypto.randomUUID(),
        body: "A newer server message",
      },
    },
  });
  const refreshed = page.waitForResponse((response) =>
    rpcPaths(response.request()).includes("/rpc/v1/messages/list"),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("index:pulse")));
  await refreshed;
  await expect.poll(() => reads).toBeGreaterThan(0);
  await expect(message).not.toContainText("Sent");
  expect(await message.evaluate((element) => element.getBoundingClientRect().height)).toBe(height);
});

test("a peer account transition clears this tab before accepting the replacement cookie", async ({
  page,
  context,
}) => {
  await login(page);
  const peer = await context.newPage();
  await peer.goto("/settings");
  await expect(peer.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await peer.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator('.week-page[data-active="true"] .own-links')).toHaveCount(0);
  await peer.getByLabel("Email or username", { exact: true }).fill("bob@test.example");
  await peer.getByLabel("Password", { exact: true }).fill("test-password-123");
  await peer.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(peer.getByRole("heading", { level: 1 })).toContainText("Week");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
  await expect(page.locator('.week-page[data-active="true"] .own-links')).not.toContainText(
    "Are.na",
  );
});

test("load more recovers every message when more than a page arrived while hidden", async ({
  page,
}) => {
  await login(page);
  await page.goto("/messages/" + fixture.conversationId);
  await expect(page.locator(".message-bubble")).not.toHaveCount(0);
  await page.evaluate(() =>
    Object.defineProperty(document, "hidden", { configurable: true, value: true }),
  );
  for (let index = 0; index < 35; index++) {
    const response = await page.request.post(apiURL + "/rpc/v1/messages/send", {
      data: {
        json: {
          conversationId: fixture.conversationId,
          clientId: crypto.randomUUID(),
          body: `Hidden arrival ${index}`,
        },
      },
    });
    expect(response.ok()).toBe(true);
  }
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.locator(".message-bubble").filter({ hasText: "Hidden arrival 34" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  for (let index = 0; index < 35; index++)
    await expect(
      page.locator(".message-bubble").filter({ hasText: new RegExp(`^Hidden arrival ${index}$`) }),
    ).toHaveCount(1);
});

test("a desktop revision change between disk restore and subscription clears the restored page", async ({
  page,
}) => {
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await login(page);
  await page.waitForTimeout(1300);
  desktop.beforeWindow = () => {
    desktop.token = null;
    desktop.revision++;
  };
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/get-session**", async (route) => {
    await held;
    await route.continue();
  });
  try {
    await page.reload();
    await expect(page.locator('.week-page[data-active="true"] .own-links')).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Are.na");
  } finally {
    release();
  }
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});

test("a failed disk erasure cannot restore signed-out content when storage recovers", async ({
  page,
}) => {
  await login(page);
  await page.waitForTimeout(1300);
  await page.evaluate(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: {
        open: () => {
          throw new DOMException("Connection lost", "InvalidStateError");
        },
      },
    });
  });
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/login/);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/get-session**", async (route) => {
    await held;
    await route.continue();
  });
  const checking = page.waitForRequest("**/api/auth/get-session**");
  try {
    await page.reload();
    await checking;
    await page.waitForTimeout(500);
    await expect(page.locator('.week-page[data-active="true"] .own-links')).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Are.na");
  } finally {
    release();
  }
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});
