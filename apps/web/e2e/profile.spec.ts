import { test, expect } from "@playwright/test";

test("profile styling stays borderless with shared display typography", async ({
  page,
  request,
}) => {
  await request.post("http://localhost:3002/_test/reset");
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
  const font = await page
    .getByRole("heading", { level: 1 })
    .evaluate((h) => getComputedStyle(h).fontFamily);
  await page.getByRole("link", { name: "Your profile", exact: true }).click();
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".profile-heading h1")).toHaveCSS("font-family", font);
    await expect(page.locator(".profile-week h2").first()).toHaveCSS("font-family", font);
    await expect(page.locator(".profile-links").first()).toHaveCSS("border-top-width", "0px");
    await page.screenshot({ path: `test-results/profile-${viewport.width}.png` });
  }
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
});
