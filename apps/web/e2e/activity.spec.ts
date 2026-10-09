import { apiURL } from "./urls";
import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}

test("comment mentions appear in Activity and open the original thread", async ({
  page,
  browser,
  request,
}) => {
  const fixture = await (await request.post(apiURL + "/_test/reset")).json();
  await login(page, "alice");
  // The shared fixture starts with Alice private; this thread must be visible to Bob.
  const publish = await page.request.patch(apiURL + "/api/v1/me/profile", {
    data: { profileVisibility: "public" },
  });
  expect(publish.ok()).toBe(true);
  await page.goto("/links/" + fixture.links[0].id);
  await page.getByLabel("Comment", { exact: true }).fill("@bob take a look at this");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(
    page.locator(".comment").filter({ hasText: "@bob take a look at this" }),
  ).toBeVisible();
  const recipient = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const bob = await recipient.newPage();
    await login(bob, "bob");
    const weekFont = await bob
      .getByRole("heading", { level: 1 })
      .evaluate((h) => getComputedStyle(h).fontFamily);
    await bob.goto("/activity");
    await expect(bob.getByRole("heading", { name: "Activity", exact: true })).toHaveCSS(
      "font-family",
      weekFont,
    );
    await expect(bob.locator(".filter-strip button")).toHaveText([
      "All",
      "Comments",
      "Requests",
      "Mentions",
      "Follows",
    ]);
    await bob.getByRole("button", { name: "Follows", exact: true }).click();
    await expect(bob).toHaveURL(/filter=follow/);
    await expect(bob.locator(".activity-row")).toContainText("started following you.");
    await bob.getByRole("button", { name: "Mentions", exact: true }).click();
    await expect(bob).toHaveURL(/filter=mention/);
    const mention = bob
      .locator(".activity-row")
      .filter({ hasText: "mentioned you: @bob take a look at this" });
    await expect(mention).toBeVisible();
    await mention.getByRole("button", { name: "Open post" }).click();
    await expect(
      bob.locator(".comment").filter({ hasText: "@bob take a look at this" }),
    ).toBeVisible();
  } finally {
    await recipient.close();
  }
});
