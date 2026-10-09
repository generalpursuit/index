import { apiURL } from "./urls";
import { test, expect } from "@playwright/test";

test("profile styling stays borderless with shared display typography", async ({
  page,
  request,
}) => {
  await request.post(apiURL + "/_test/reset");
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
    await page.screenshot({ path: `test-results/profile-${viewport.width}.png` });
  }
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
});

test("the profile lists weeks under sticky headings, with a scrubber and a list menu", async ({
  page,
  request,
}) => {
  const fixture = await (await request.post(apiURL + "/_test/reset")).json();
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Your profile", exact: true }).click();
  const weeks = page.locator(".profile-week");
  await expect(weeks).toHaveCount(2);
  // The current week offers the field; older weeks only list what was saved.
  await expect(
    weeks.first().getByRole("textbox", { name: /Enter a link to add it/ }),
  ).toBeVisible();
  const older = page.locator(`.profile-week[data-week="${fixture.older}"]`);
  await expect(older).toContainText("Earlier notes");
  await expect(older.getByRole("textbox")).toHaveCount(0);
  // The scrubber jumps to a week, whose heading then sticks at the top while you read it.
  // Even the last week can get there: the list leaves just enough room after it.
  const scroller = page.locator("#app-scroll");
  const headingOffset = (week: typeof older) => async () => {
    const [heading, top] = await Promise.all([
      week.locator(".profile-week-heading").boundingBox(),
      scroller.boundingBox(),
    ]);
    return Math.round(heading!.y - top!.y);
  };
  await page.locator(".week-tick").nth(1).click();
  await expect.poll(headingOffset(older)).toBe(0);
  await expect(page.locator(".week-tick").nth(1)).toHaveAttribute("data-active", "true");
  expect(await scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBe(0);
  await page.locator(".week-tick").first().click();
  await expect.poll(headingOffset(weeks.first())).toBe(0);
  await expect(page.locator(".week-tick").first()).toHaveAttribute("data-active", "true");
  await scroller.evaluate((el) => el.scrollBy(0, 60));
  await expect.poll(headingOffset(weeks.first())).toBe(0);
  // The week titles open the same choice as a list, for keyboards and phones.
  await older.getByRole("button", { name: /Jump to a week/ }).click();
  await page.getByRole("dialog", { name: "Weeks" }).getByRole("button").first().click();
  await expect(page.getByRole("dialog", { name: "Weeks" })).toHaveCount(0);
  // The list menu rides on the sticky row; Starred (others' links) is only on your own profile.
  await page.getByRole("button", { name: "Showing All", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Starred" }).click();
  await expect(page.getByRole("button", { name: "Showing Starred", exact: true })).toBeVisible();
  await page.goto("/people/" + fixture.people.Lena);
  await page.getByRole("button", { name: "Showing All", exact: true }).click();
  await expect(page.getByRole("menuitemradio", { name: "Starred" })).toHaveCount(0);
});
