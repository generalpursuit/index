import { apiURL } from "./urls";
import { routeRPC } from "./rpc";
import { test, expect } from "@playwright/test";

test("profile names fit on one line through phone and desktop resizes", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await request.post(apiURL + "/_test/reset");
  const login = await request.post(apiURL + "/api/auth/sign-in/email", {
    data: { email: "alice@test.example", password: "test-password-123" },
  });
  const token = login.headers()["set-auth-token"]!;
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
  for (const name of ["Jona Schwarz", "Alexandria Éléonore von Schwarzenberg " + "W".repeat(40)]) {
    await request.patch(apiURL + "/api/v1/me/profile", {
      headers: { Authorization: `Bearer ${token}` },
      data: { name },
    });
    await page.goto("/u/alice");
    const heading = page.getByRole("heading", { name, exact: true });
    await expect(heading).toBeVisible();
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 402, height: 874 },
      { width: 874, height: 402 },
      { width: 1440, height: 960 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          heading.evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            // The visibility mark follows the name itself, within the row.
            const text = element.firstElementChild!.getBoundingClientRect(),
              mark = element.nextElementSibling!.getBoundingClientRect();
            return (
              range.getClientRects().length > 0 &&
              element.scrollWidth <= element.clientWidth + 1 &&
              element.getBoundingClientRect().height <=
                parseFloat(getComputedStyle(element).fontSize) + 1 &&
              mark.left >= text.right &&
              mark.left - text.right <= 16 &&
              mark.right <= element.parentElement!.getBoundingClientRect().right + 1
            );
          }),
        )
        .toBe(true);
      await expect(heading).toHaveText(name);
    }
    // Back at full width, a name that fits returns to its full size.
    if (name === "Jona Schwarz")
      await expect.poll(() => heading.evaluate((element) => element.style.fontSize)).toBe("");
  }
  expect(errors).toEqual([]);
});

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

test("the profile lists weeks under sticky headings, with a scrubber and a list dock", async ({
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
  // The scrubber marks every week on screen: with the whole list in view, all of them.
  const ticks = page.locator(".week-tick");
  await expect(ticks.first()).toHaveAttribute("data-active", "true");
  await expect(ticks.nth(1)).toHaveAttribute("data-active", "true");
  // On a shorter screen it jumps to a week, whose heading then sticks at the top while you read
  // it. Nothing follows the last week, so jumping there scrolls only as far as the list goes.
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ ...viewport, height: 400 });
  await expect(ticks.nth(1)).not.toHaveAttribute("data-active");
  const scroller = page.locator("#app-scroll");
  const headingOffset = (week: typeof older) => async () => {
    const [heading, top] = await Promise.all([
      week.locator(".profile-week-heading").boundingBox(),
      scroller.boundingBox(),
    ]);
    return Math.round(heading!.y - top!.y);
  };
  await ticks.nth(1).click();
  await expect(older).toBeInViewport();
  await expect(ticks.nth(1)).toHaveAttribute("data-active", "true");
  // Chromium can leave a fractional CSS pixel after smooth scrolling settles.
  await expect
    .poll(() =>
      scroller.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop)),
    )
    .toBeLessThanOrEqual(1);
  // The dock floats over the foot of the list, which scrolls far enough to clear it.
  const dock = page.getByRole("navigation", { name: "Lists" });
  const [lastRow, dockBox] = await Promise.all([
    older.locator(".link-row").last().boundingBox(),
    dock.boundingBox(),
  ]);
  expect(lastRow!.y + lastRow!.height).toBeLessThanOrEqual(dockBox!.y);
  await ticks.first().click();
  await expect.poll(headingOffset(weeks.first())).toBe(0);
  await expect(ticks.first()).toHaveAttribute("data-active", "true");
  await scroller.evaluate((el) => el.scrollBy(0, 60));
  await expect.poll(headingOffset(weeks.first())).toBe(0);
  await page.setViewportSize(viewport);
  // The week titles open the same choice as a list, for keyboards and phones.
  await older.getByRole("button", { name: /Jump to a week/ }).click();
  await page.getByRole("dialog", { name: "Weeks" }).getByRole("button").first().click();
  await expect(page.getByRole("dialog", { name: "Weeks" })).toHaveCount(0);
  // Chips link to each list. The one on screen sets where the add row starts saving.
  const chip = (name: string) => dock.getByRole("link", { name, exact: true });
  const destination = page.getByRole("button", { name: /^Save destination:/ });
  await expect(chip("All")).toHaveAttribute("aria-current", "page");
  await expect(destination).toHaveAccessibleName("Save destination: Your links");
  await chip("Reading").click();
  await expect(page).toHaveURL(/\/u\/alice\/reading$/);
  await expect(chip("Reading")).toHaveAttribute("aria-current", "page");
  await expect(chip("All")).not.toHaveAttribute("aria-current");
  // Only the list on screen sits on a quiet pill; the others are plain text.
  await expect(chip("Reading")).toHaveCSS("background-color", "rgb(235, 235, 235)");
  await expect(chip("Reading")).toHaveCSS("color", "rgb(23, 23, 23)");
  await expect(chip("All")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(chip("All")).toHaveCSS("border-top-width", "0px");
  await expect(destination).toHaveAccessibleName("Save destination: Reading");
  // A private list's lock is also spoken.
  const notes = chip("Notes, only you");
  await expect(notes.locator(".lucide-lock-keyhole")).toHaveCount(1);
  await expect(chip("Reading")).toHaveAccessibleName("Reading");
  await notes.click();
  await expect(destination).toHaveAccessibleName("Save destination: Notes, only you");
  // Starred (others' links you kept) and Favorites are not destinations, so they have no add row.
  await chip("Starred").click();
  await expect(chip("Starred")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("textbox", { name: /Enter a link/ })).toHaveCount(0);
  await expect(dock.getByRole("button", { name: "New group", exact: true })).toBeVisible();
  // Others' profiles get their visible lists, without Starred or a new group.
  await page.goto("/people/" + fixture.people.Lena);
  await expect(chip("Reading")).toBeVisible();
  await expect(chip("All")).toHaveAttribute("aria-current", "page");
  await expect(chip("Starred")).toHaveCount(0);
  await expect(dock.getByRole("button", { name: "New group", exact: true })).toHaveCount(0);
});

test("a long profile renders only the weeks near the screen", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = await (await request.post(apiURL + "/_test/reset")).json();
  // Years of older weeks, each counting three links.
  const older = Array.from({ length: 150 }, (_, i) => {
    const day = new Date(fixture.older + "T00:00:00Z");
    day.setUTCDate(day.getUTCDate() - 7 * (i + 1));
    return { weekStart: day.toISOString().slice(0, 10), count: 3 };
  });
  await routeRPC(page, "**/rpc/v1/links/weeks**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.json.items.push(...older);
    body.json.nextBefore = null;
    await route.fulfill({ response, json: body });
  });
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Your profile", exact: true }).click();
  const weeks = page.locator(".profile-week");
  await expect(page.locator(".week-tick")).toHaveCount(older.length + 2);
  await expect(weeks.first()).toBeVisible();
  expect(await weeks.count()).toBeLessThan(20);
  const field = page.getByRole("textbox", { name: /Enter a link to add it/ });
  await field.fill("example.com/draft");
  // The picker jumps to a week far down, which lands at the top under its heading.
  await weeks
    .first()
    .getByRole("button", { name: /Jump to a week/ })
    .click();
  await page.getByRole("dialog", { name: "Weeks" }).getByRole("button").nth(102).click();
  const far = page.locator(`.profile-week[data-week="${older[100]!.weekStart}"]`);
  const scroller = page.locator("#app-scroll");
  await expect
    .poll(async () => {
      const [heading, top] = await Promise.all([
        far.locator(".profile-week-heading").boundingBox(),
        scroller.boundingBox(),
      ]);
      return heading && Math.round(heading.y - top!.y);
    })
    .toBe(0);
  expect(await weeks.count()).toBeLessThan(20);
  // The week with the field stays rendered, so its draft is still there on the way back.
  await page.locator(".week-tick").first().click();
  await expect(field).toBeInViewport();
  await expect(field).toHaveValue("example.com/draft");
  expect(errors).toEqual([]);
});
