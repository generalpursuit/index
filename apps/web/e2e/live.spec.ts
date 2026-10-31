import { test, expect } from "@playwright/test";
import { apiURL } from "./urls";

test("idle clients make no periodic database requests and messages arrive without notification enrollment", async ({
  page,
  request,
}) => {
  const fixture = await (await request.post(apiURL + "/_test/reset")).json();
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice@test.example");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
  await page.goto(`/messages/${fixture.conversationId}`);
  await expect(page.locator(".chat-scroller")).toBeVisible();
  // Finish the initial focus, connection and read-receipt reconciliations.
  await page.waitForLoadState("networkidle");
  const calls: string[] = [];
  page.on("request", (event) => {
    if (event.url().startsWith(apiURL)) calls.push(event.url());
  });
  await page.clock.install();
  await page.clock.runFor(10 * 60_000);
  expect(calls).toEqual([]);
  await page.clock.resume();
  await request.post(apiURL + "/_test/notify");
  await expect(page.locator(".chat-scroller")).toContainText("PRIVATE browser fixture");
});
