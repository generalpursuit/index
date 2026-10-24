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
    // The previous screen stays visible while the route's new data loads.
    await expect(bob.getByRole("button", { name: "Follows", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const follow = bob.locator(".activity-row");
    await expect(follow).toHaveCount(1);
    await expect(follow.locator("header")).toContainText("started following you");
    const follower = await follow.locator("header a").textContent();
    await bob.getByRole("button", { name: "Mentions", exact: true }).click();
    await expect(bob).toHaveURL(/filter=mention/);
    // Each row says what happened, and a comment's row shows the comment.
    const mention = bob.locator(".activity-row").filter({ hasText: "mentioned you in a comment" });
    await expect(mention.locator("p")).toHaveText("@bob take a look at this");
    await expect(mention.getByRole("link", { name: "Open post", exact: true })).toBeVisible();
    // The whole row opens the post, not only its chevron. Its middle is the comment's text.
    const comment = bob.locator(".comment").filter({ hasText: "@bob take a look at this" });
    await mention.click();
    await expect(comment).toBeVisible();
    await bob.keyboard.press("Escape");
    await expect(comment).toBeHidden();
    // The name stays a link of its own, above the row's.
    const author = await mention.locator("header a").textContent();
    await mention.locator("header a").click();
    await expect(bob).toHaveURL(new RegExp(`/u/${author}$`));
    // A row without a post opens the person who acted.
    await bob.goto("/activity?filter=follow");
    await follow.click();
    await expect(bob).toHaveURL(new RegExp(`/u/${follower}$`));
  } finally {
    await recipient.close();
  }
});
