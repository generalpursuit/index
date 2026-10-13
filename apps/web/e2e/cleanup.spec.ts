import { test, expect, type Page } from "@playwright/test";
import { apiURL } from "./urls";

let fixture: {
  links: { id: string; shortId: string; title: string }[];
  reading: { id: string; slug: string };
  conversationId: string;
  conversationShortId: string;
};
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}
async function attachFromHome(page: Page) {
  await page.getByRole("link", { name: "Home", exact: true }).click();
  const row = page
    .locator('.week-page[data-active="true"] .own-links .link-row')
    .filter({ hasText: "Are.na" });
  await row.getByRole("button", { name: "Are.na", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Post", exact: true })
    .getByRole("button", { name: "Forward", exact: true })
    .click();
  await page.getByRole("checkbox", { name: "Bob", exact: true }).click();
  await page.getByRole("checkbox", { name: "Lena", exact: true }).click();
  await page.getByRole("button", { name: "Next (2)", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/messages/" + fixture.conversationShortId));
}
test.beforeEach(async ({ request }) => {
  fixture = await (await request.post(apiURL + "/_test/reset")).json();
});

for (const outcome of ["lost", "pending"] as const) {
  test(`an attachment arriving after a ${outcome} send belongs to the next message`, async ({
    page,
  }) => {
    await login(page);
    await page.goto("/messages/" + fixture.conversationId);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests: { clientId: string; body: string; linkId?: string }[] = [];
    let accepted = false;
    await page.route("**/rpc/v1/messages/send", async (route) => {
      requests.push(route.request().postDataJSON().json);
      if (requests.length > 1) return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      accepted = true;
      if (outcome === "lost") await route.abort("failed");
      else {
        await held;
        await route.fulfill({ response });
      }
    });
    try {
      await page.getByLabel("Message", { exact: true }).fill("Keep the first payload");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect.poll(() => accepted).toBe(true);
      if (outcome === "lost")
        await expect(
          page.getByRole("alert").filter({ hasText: "Delivery is unconfirmed" }),
        ).toBeVisible();
      await attachFromHome(page);
      await expect(
        page.getByRole("status").filter({ hasText: "For your next message: Are.na" }),
      ).toBeVisible();
      await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
        "Keep the first payload",
      );
      await expect(page.getByLabel("Message", { exact: true })).toBeDisabled();
      if (outcome === "lost")
        await page.getByRole("button", { name: "Send message", exact: true }).click();
      else release();
      await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
      await expect(page.locator(".draft-attachment")).toContainText("Are.na");
      await expect(
        page.locator(".message-bubble").filter({ hasText: "Keep the first payload" }),
      ).toHaveCount(1);
      if (outcome === "lost") expect(requests[1]).toEqual(requests[0]);
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(page.locator(".draft-attachment")).toHaveCount(0);
      expect(requests.at(-1)!.clientId).not.toBe(requests[0]!.clientId);
      expect(requests.at(-1)!.linkId).toBeTruthy();
    } finally {
      release();
    }
  });
}

test("a definite send rejection retains editable input and the corrected send has a new identity", async ({
  page,
}) => {
  await login(page);
  await page.goto("/messages/" + fixture.conversationId);
  const ids: string[] = [];
  await page.route("**/rpc/v1/messages/send", async (route) => {
    ids.push(route.request().postDataJSON().json.clientId);
    if (ids.length === 1)
      await route.fulfill({
        status: 400,
        json: { json: { code: "BAD_REQUEST", status: 400, message: "Check the message" } },
      });
    else await route.continue();
  });
  const input = page.getByLabel("Message", { exact: true });
  await input.fill("Rejected");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Message was rejected" })).toBeVisible();
  await expect(input).toBeEnabled();
  await input.fill("Corrected");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(input).toHaveValue("");
  expect(ids[1]).not.toBe(ids[0]);
});

test("a deleted forwarded link permits confirmed recovery without guessing whether a send committed", async ({
  page,
}) => {
  await login(page);
  await attachFromHome(page);
  const removed = await page.request.delete(apiURL + "/api/v1/links/" + fixture.links[0]!.id);
  expect(removed.ok()).toBe(true);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Delivery is unconfirmed" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start a new message", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Discard this unconfirmed draft?" });
  await expect(confirmation).toContainText("may already have been delivered");
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".draft-attachment")).toContainText("Are.na");
  await page.getByRole("button", { name: "Start a new message", exact: true }).click();
  await confirmation.getByRole("button", { name: "Discard draft", exact: true }).click();
  await expect(page.locator(".draft-attachment")).toHaveCount(0);
  await page.getByLabel("Message", { exact: true }).fill("A new message after recovery");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.locator(".message-bubble").filter({ hasText: "A new message after recovery" }),
  ).toHaveCount(1);
});

test("saved link edits reopen with the saved values; failed edits keep unsaved input", async ({
  page,
}) => {
  await login(page);
  const openEditor = async (title: string) => {
    const row = page
      .locator('.week-page[data-active="true"] .own-links .link-row')
      .filter({ hasText: title });
    await row.getByRole("button", { name: title, exact: true }).click();
    await page
      .getByRole("dialog", { name: "Post", exact: true })
      .getByRole("link", { name: "Edit", exact: true })
      .click();
  };
  await openEditor("Are.na");
  const editor = page.getByRole("dialog", { name: "Edit link", exact: true });
  await editor.getByLabel("Title", { exact: true }).fill("Updated title");
  await editor.getByLabel("Note", { exact: true }).fill("Updated note");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  // Saving goes back to the post, which shows the change.
  const post = page.getByRole("dialog", { name: "Post", exact: true });
  await expect(post.getByRole("heading", { name: "Updated title", exact: true })).toBeVisible();
  await post.getByRole("button", { name: "Close", exact: true }).click();
  await openEditor("Updated title");
  await expect(editor.getByLabel("Title", { exact: true })).toHaveValue("Updated title");
  await expect(editor.getByLabel("Note", { exact: true })).toHaveValue("Updated note");
  await page.route("**/rpc/v1/links/update", (route) => route.abort("failed"));
  await editor.getByLabel("Title", { exact: true }).fill("Unsaved title");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await openEditor("Updated title");
  await expect(editor.getByLabel("Title", { exact: true })).toHaveValue("Unsaved title");
});

test("account transition discards a pending draft and its late completion cannot clear the new account draft", async ({
  page,
}) => {
  await login(page);
  await page.goto("/messages/" + fixture.conversationId);
  let accepted = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/v1/messages/send", async (route) => {
    const response = await route.fetch();
    accepted = true;
    await held;
    await route.fulfill({ response });
  });
  try {
    await page.getByLabel("Message", { exact: true }).fill("Alice pending send");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => accepted).toBe(true);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("Email or username", { exact: true }).fill("bob");
    await page.getByLabel("Password", { exact: true }).fill("test-password-123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("link", { name: "Messages", exact: true }).click();
    await page.locator(`a[href="/messages/${fixture.conversationShortId}"]`).click();
    const input = page.getByLabel("Message", { exact: true });
    await expect(input).toHaveValue("");
    await input.fill("Bob unsent draft");
    const completed = page.waitForResponse((response) => response.url().endsWith("/messages/send"));
    release();
    await completed;
    await expect(input).toHaveValue("Bob unsent draft");
    await expect(
      page.getByRole("alert").filter({ hasText: "Delivery is unconfirmed" }),
    ).toHaveCount(0);
  } finally {
    release();
  }
});

test("a profile group beyond page one remains unknown on failure, then loads on retry", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);
  for (let start = 0; start < 101; start += 10) {
    const responses = await Promise.all(
      Array.from({ length: Math.min(10, 101 - start) }, (_, offset) =>
        page.request.post(apiURL + "/api/v1/groups", {
          data: { name: `Collection ${start + offset}` },
        }),
      ),
    );
    expect(responses.every((response) => response.ok())).toBe(true);
  }
  let requests = 0;
  let fail = true;
  await page.route("**/rpc/v1/groups/list**", async (route) => {
    requests++;
    if (requests > 1 && fail)
      await route.fulfill({
        status: 503,
        json: {
          json: { code: "INTERNAL_SERVER_ERROR", status: 503, message: "Group index unavailable" },
        },
      });
    else await route.continue();
  });
  await page.goto("/u/alice/" + fixture.reading.slug);
  await expect(page.locator(".profile-links").getByRole("alert")).toBeVisible();
  await expect(page.getByText("Nothing in this group yet", { exact: true })).toHaveCount(0);
  fail = false;
  await page
    .locator(".profile-links")
    .getByRole("button", { name: "Try again", exact: true })
    .click();
  const lists = page.getByRole("navigation", { name: "Lists" });
  await expect(lists.getByRole("link", { name: "Reading", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator(".profile-links .link-row")).not.toHaveCount(0);
  // All, Favorites, Reading, Notes, 101 collections across two group pages, and Starred.
  await expect(lists.getByRole("link")).toHaveCount(106);
  // The dock scrolls to show the list on screen, however far along it is.
  await page.goto("/u/alice/collection-100");
  await expect(lists.getByRole("link", { name: "Collection 100", exact: true })).toBeInViewport({
    ratio: 1,
  });
});

test("week index errors expose retry without hiding the loaded feed", async ({ page }) => {
  await page.route("**/rpc/v1/feed/weeks**", (route) =>
    route.fulfill({
      status: 503,
      json: { json: { code: "INTERNAL_SERVER_ERROR", status: 503, message: "Weeks unavailable" } },
    }),
  );
  await login(page);
  await expect(page.locator('.week-page[data-active="true"] .own-links')).toContainText("Are.na");
  await expect(page.getByRole("button", { name: "Retry weeks", exact: true })).toBeVisible();
  await page.unroute("**/rpc/v1/feed/weeks**");
  await page.getByRole("button", { name: "Retry weeks", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry weeks", exact: true })).toHaveCount(0);
});
