import { test, expect, type Page } from "@playwright/test";
import { DesktopHarness } from "./desktop-harness";
import { apiURL } from "./urls";
async function login(page: Page, identifier = "alice@test.example") {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill(identifier);
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}
async function add(page: Page, url: string) {
  await page.getByRole("textbox", { name: "Add a link to this week" }).fill(url);
  await page.getByRole("textbox", { name: "Add a link to this week" }).press("Enter");
}

test("menu bar shares current-week data, destination choice, duplicate flow and canonical main navigation", async ({
  page,
  context,
  request,
}) => {
  await request.post(apiURL + "/_test/reset");
  const desktop = new DesktopHarness();
  desktop.releaseChannel = "staging";
  desktop.updatesEnabled = true;
  await desktop.attach(page, "main");
  await login(page);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 390, height: 560 });
  await desktop.attach(panel, "menu-bar");
  await panel.goto("/menu-bar");
  await expect(panel.getByRole("heading", { level: 1 })).toContainText("Week");
  await expect(panel.getByLabel("Index Staging", { exact: true })).toHaveCount(0);
  // Opening refreshes the panel, so it offers no refresh of its own.
  await expect(panel.getByRole("button", { name: "Refresh links" })).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Open Are.na in browser", exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole("button", { name: /Open .*in browser/ })).toHaveCount(5);
  // The native panel hugs this week's content.
  const panelHeight = (command: string) =>
    desktop.commands.findLast((c) => c.label === "menu-bar" && c.command === command)?.args
      ?.height as number | undefined;
  await expect.poll(() => panelHeight("desktop_panel_resize")).toBeGreaterThan(300);
  const fitted = panelHeight("desktop_panel_resize")!;
  expect(fitted).toBeLessThan(560);
  expect(panelHeight("desktop_panel_ready")).toBeLessThan(560);
  await panel.getByRole("button", { name: "Open Are.na in browser", exact: true }).click();
  await expect.poll(() => desktop.opened).toContain("https://are.na/");
  await expect(panel).toHaveURL(/\/menu-bar$/);
  await panel.getByRole("button", { name: "Save destination: Your links" }).click();
  // The menu opens inside the panel; Escape closes it and leaves the panel open.
  const menu = panel.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect
    .poll(async () => {
      const box = (await menu.boundingBox())!;
      return box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 560;
    })
    .toBe(true);
  const menuBottom = await menu.evaluate((element) => element.getBoundingClientRect().bottom);
  await expect.poll(() => panelHeight("desktop_panel_resize")).toBeGreaterThan(menuBottom);
  await panel.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  expect(desktop.hidden).not.toContain("menu-bar");
  // Groups are created in the main app; the panel's menu only chooses among them.
  await panel.getByRole("button", { name: "Save destination: Your links" }).click();
  const reading = menu.getByRole("menuitemradio", { name: "Reading", exact: true });
  await expect(reading).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveCount(0);
  await expect(menu.getByRole("separator")).toHaveCount(0);
  await reading.click();
  await expect(panel.getByRole("button", { name: "Save destination: Reading" })).toBeFocused();
  await add(panel, "https://pages.test/calm-software");
  await expect(panel.getByText("Link added to Reading", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: /Open Calm Software in browser/ })).toBeVisible();
  // The footer ends the panel with two full-width rows, like the end of a native menu.
  for (const name of ["Open Index", "Quit Index"]) {
    const item = panel.getByRole("button", { name, exact: true });
    await item.click({ trial: true });
    expect(await item.evaluate((el: HTMLElement) => [el.offsetHeight, el.offsetWidth])).toEqual([
      28,
      await panel.evaluate(() => document.documentElement.clientWidth - 20),
    ]);
  }
  await expect
    .poll(async () => {
      const toastBox = await panel.locator("[data-sonner-toast]").last().boundingBox();
      const footerBox = await panel.locator("footer").boundingBox();
      return toastBox!.y + toastBox!.height - footerBox!.y;
    })
    .toBeLessThanOrEqual(0);
  await expect(
    page
      .locator(".week-page[data-active=true]")
      .getByRole("button", { name: "Calm Software", exact: true })
      .first(),
  ).toBeVisible();
  await add(panel, "https://pages.test/calm-software");
  // A line under the field rather than a sheet over the panel.
  const saved = panel.getByRole("status").filter({ hasText: "Already saved this week" });
  await expect(saved).toBeVisible();
  await expect(panel.getByRole("dialog")).toHaveCount(0);
  await panel.screenshot({ path: "test-results/menu-bar-already-saved.png" });
  await saved.getByRole("button", { name: "View", exact: true }).click();
  await expect(page).toHaveURL(/\/l\/[A-Za-z0-9_-]+$/);
  await expect(panel).toHaveURL(/\/menu-bar$/);
  await expect.poll(() => desktop.pending).toBeNull();
  await panel.getByRole("textbox", { name: "Add a link to this week" }).press("Enter");
  await expect(saved).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /Open Calm Software in browser/ })).toHaveCount(2);
  await panel.screenshot({ path: "test-results/menu-bar-compact.png" });
  // Over the panel's glass, text is translucent so it takes on the tone behind the panel.
  const heading = panel.getByRole("heading", { level: 1 }),
    subtle = panel.getByText(/· Your links$/);
  await expect(heading).toHaveCSS("color", "rgba(0, 0, 0, 0.88)");
  await expect(subtle).toHaveCSS("color", "rgba(0, 0, 0, 0.55)");
  await expect(panel.locator("footer hr")).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0.1)");
  await page.goto("/settings");
  await page.getByRole("radio", { name: "Dark", exact: true }).check();
  await expect(panel.locator("html")).toHaveAttribute("data-theme-preference", "dark");
  await expect
    .poll(() => desktop.appearances.filter((value) => value.label === "menu-bar").at(-1)?.resolved)
    .toBe("dark");
  await expect(heading).toHaveCSS("color", "rgba(255, 255, 255, 0.88)");
  await expect(subtle).toHaveCSS("color", "rgba(255, 255, 255, 0.55)");
  await panel.screenshot({ path: "test-results/menu-bar-dark.png" });
  expect(
    desktop.commands.filter((c) => c.label === "menu-bar" && c.command.startsWith("notification_")),
  ).toHaveLength(0);
  expect(
    desktop.events.every((event) => JSON.stringify(event.payload).indexOf("signed") === -1),
  ).toBe(true);
});

test("menu rows show a favorite's heart but keep their one action, opening the link", async ({
  page,
  context,
  request,
}) => {
  await request.post(apiURL + "/_test/reset");
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await login(page);
  const favorite = page
    .locator('.week-page[data-active="true"] .own-links')
    .getByRole("button", { name: "Favorite Are.na", exact: true });
  await Promise.all([page.waitForResponse("**/rpc/v1/favorites/add**"), favorite.click()]);
  const panel = await context.newPage();
  await desktop.attach(panel, "menu-bar");
  await panel.goto("/menu-bar");
  const kept = panel.getByRole("button", { name: "Open Are.na in browser", exact: true });
  await expect(kept.locator(".link-mark[data-kept] svg")).toHaveCSS("opacity", "1");
  await expect(
    panel
      .getByRole("button", { name: "Open In Rainbows in browser", exact: true })
      .locator(".link-mark[data-kept]"),
  ).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /^(Favorite|Star) / })).toHaveCount(0);
  await kept.locator(".link-mark").click();
  await expect.poll(() => desktop.opened).toContain("https://are.na/");
});
test("only the menu panel's links scroll, by whole rows, loading more near their end", async ({
  page,
  context,
  request,
}) => {
  await request.post(apiURL + "/_test/reset");
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await login(page);
  // More than a page of links this week.
  for (let i = 1; i <= 36; i++) {
    const created = await request.post(apiURL + "/api/v1/links", {
      headers: { Authorization: `Bearer ${desktop.token}` },
      data: { url: `https://pages.test/long-week-${i}`, title: `Long week ${i}` },
    });
    expect(created.ok()).toBe(true);
  }
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 390, height: 560 });
  await desktop.attach(panel, "menu-bar");
  await panel.goto("/menu-bar");
  const rows = panel.getByRole("button", { name: /Open .*in browser/ });
  await expect(rows).toHaveCount(30);
  // At its maximum height the panel shows whole rows; the native window takes that height.
  await expect
    .poll(() =>
      desktop.commands.findLast(
        (c) => c.label === "menu-bar" && c.command === "desktop_panel_resize",
      ),
    )
    .toBeTruthy();
  const height = desktop.commands.findLast(
    (c) => c.label === "menu-bar" && c.command === "desktop_panel_resize",
  )!.args!.height as number;
  expect(height).toBeLessThanOrEqual(560);
  expect(height).toBeGreaterThan(560 - 34);
  await panel.setViewportSize({ width: 390, height });
  const list = panel.locator(".link-list");
  await expect.poll(() => list.evaluate((el) => Math.round(el.clientHeight) % 34)).toBe(0);
  expect(await list.evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe("none");
  await expect(list).toHaveAttribute("data-fade-end", "true");
  await expect(list).not.toHaveAttribute("data-fade-start");
  // The field is a row like the links: the first link follows it as each link follows another.
  const [fieldRow, first, second] = await Promise.all(
    [panel.locator(".quick-add"), rows.nth(0), rows.nth(1)].map(
      async (row) => (await row.boundingBox())!.y,
    ),
  );
  expect(first - fieldRow).toBe(second - first);
  const field = panel.getByRole("textbox", { name: "Add a link to this week" });
  const footer = panel.locator("footer");
  const heading = panel.getByRole("heading", { level: 1 });
  const fixed = async () =>
    [heading, field, footer].map(async (part) => (await part.boundingBox())!.y);
  const before = await Promise.all(await fixed());
  // Reaching the end loads the next page by itself.
  await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(rows).toHaveCount(41);
  await expect(panel.getByRole("button", { name: "Load more" })).toHaveCount(0);
  await expect(list).toHaveAttribute("data-fade-start", "true");
  expect(await Promise.all(await fixed())).toEqual(before);
  expect(await panel.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
  // Scrolling while open stays through the refresh of an opening.
  const scrolled = await list.evaluate((el) => el.scrollTop);
  expect(scrolled).toBeGreaterThan(0);
  const commands = desktop.commands.length;
  await desktop.emit("index:menu-open", { presented: true }, "menu-bar");
  await expect
    .poll(() => desktop.commands.slice(commands).some((c) => c.command === "desktop_panel_ready"))
    .toBe(true);
  expect(await list.evaluate((el) => el.scrollTop)).toBe(scrolled);
  // Closing goes back to the top at once, so the next opening starts there.
  await desktop.emit("index:menu-closed", null, "menu-bar");
  expect(await list.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(list).not.toHaveAttribute("data-fade-start");
});

test("the panel window always fits its content and its page never scrolls", async ({
  page,
  context,
  request,
}) => {
  const fixture = await (await request.post(apiURL + "/_test/reset")).json();
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await login(page);
  const headers = { Authorization: `Bearer ${desktop.token}` };
  const week = new Date();
  week.setUTCHours(0, 0, 0, 0);
  week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
  const listed = await request.get(
    `${apiURL}/api/v1/profiles/${fixture.people.Alice}/links?weekStart=${week.toISOString().slice(0, 10)}&limit=100`,
    { headers },
  );
  for (const link of (await listed.json()).items)
    await request.delete(`${apiURL}/api/v1/links/${link.id}`, { headers });
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 390, height: 560 });
  await desktop.attach(panel, "menu-bar");
  await panel.goto("/menu-bar");
  const field = panel.getByRole("textbox", { name: "Add a link to this week" });
  await expect(field).toBeVisible();
  const rows = panel.getByRole("button", { name: /Open .*in browser/ });
  // The window is the height the page asked for, which is exactly its content: nothing cut or
  // covered, no space left over, and no scrolling page.
  const fits = () =>
    expect
      .poll(async () => ({
        window:
          Math.abs(
            (await panel.evaluate(() => visualViewport?.height ?? innerHeight)) -
              desktop.panel.height,
          ) < 1,
        ...(await panel.evaluate(() => {
          const page = document.scrollingElement!,
            list = document.querySelector<HTMLElement>(".link-list"),
            content = document.querySelector("main > div")!.getBoundingClientRect(),
            footer = document.querySelector("footer")!.getBoundingClientRect();
          // The bottom of everything in the content, the list's rows aside.
          let extent = content.top;
          for (const element of document.querySelectorAll("main > div *")) {
            if (element.parentElement?.closest(".link-list")) continue;
            const box = element.getBoundingClientRect();
            if (box.height) extent = Math.max(extent, box.bottom);
          }
          return {
            pageScrolls: page.scrollHeight > page.clientHeight || page.scrollTop > 0,
            contentCut: Math.round(extent - content.bottom) > 0,
            listHides: !!list && list.scrollHeight > list.clientHeight + 1,
            aboveFooter: Math.max(0, Math.floor(footer.top - content.bottom) - 1),
            belowFooter: Math.round(innerHeight - footer.bottom),
          };
        })),
      }))
      .toEqual({
        window: true,
        pageScrolls: false,
        contentCut: false,
        listHides: false,
        aboveFooter: 0,
        belowFooter: 10,
      });
  const refresh = () =>
    desktop.emit("index:desktop-data", { revision: desktop.revision, source: "main" });
  // An empty week shows only the header, the field and the footer.
  await desktop.togglePanel();
  await expect(rows).toHaveCount(0);
  await fits();
  // Links added and removed while the panel is closed or open.
  await desktop.togglePanel();
  const added = [];
  for (const i of [1, 2, 3]) {
    const created = await request.post(apiURL + "/api/v1/links", {
      headers,
      data: { url: `https://pages.test/fit-${i}`, title: `Fit ${i}` },
    });
    added.push((await created.json()).id);
  }
  await refresh();
  await desktop.togglePanel();
  await expect(rows).toHaveCount(3);
  await fits();
  await desktop.togglePanel();
  for (const id of added) await request.delete(`${apiURL}/api/v1/links/${id}`, { headers });
  await refresh();
  await desktop.togglePanel();
  await expect(rows).toHaveCount(0);
  await fits();
  // Growth outside the list, which an empty list cannot make room for.
  await field.fill("not a link");
  await field.press("Enter");
  await expect(panel.getByText("Enter a web link (https://…)")).toBeVisible();
  await fits();
  // A save in an empty week grows the panel by a row outside the list, then into the list.
  await field.fill("https://pages.test/calm-software");
  await field.press("Enter");
  await expect(rows).toHaveCount(1);
  await fits();
  // So does the line under the field for a link saved before.
  await field.fill("https://pages.test/calm-software");
  await field.press("Enter");
  const saved = panel.getByRole("status").filter({ hasText: "Already saved this week" });
  await expect(saved).toBeVisible();
  await fits();
  await field.fill("");
  await expect(saved).toHaveCount(0);
  await fits();
  // An opening the host cannot show at once goes through the session check while hidden.
  await desktop.togglePanel();
  desktop.panel.committed = undefined;
  await desktop.togglePanel();
  await expect.poll(() => desktop.panel.shown).toBe(true);
  await fits();
  // The destination menu grows the panel while open, then gives the room back.
  await panel.getByRole("button", { name: "Save destination: Your links" }).click();
  await expect(panel.getByRole("menu")).toBeVisible();
  await panel.keyboard.press("Escape");
  await expect(panel.getByRole("menu")).toHaveCount(0);
  await fits();
});

test("an opening for the same account shows cached links at once and refreshes them calmly in place", async ({
  page,
  context,
  request,
}) => {
  await request.post(apiURL + "/_test/reset");
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await login(page);
  const panel = await context.newPage();
  await desktop.attach(panel, "menu-bar");
  await panel.goto("/menu-bar");
  const row = panel.getByRole("button", { name: "Open Are.na in browser", exact: true });
  await expect(row).toBeVisible();
  // Before any opening, the hidden panel tells the host its content is for this account.
  await expect
    .poll(() =>
      desktop.commands.some(
        (c) =>
          c.label === "menu-bar" &&
          c.command === "desktop_panel_ready" &&
          c.args?.expectedRevision === desktop.revision,
      ),
    )
    .toBe(true);
  // Each window hears only of its own opening.
  const listeners = (target: Page, event: string) =>
    target.evaluate((name) => (window as any).__desktopListeners.get(name)?.size ?? 0, event);
  expect(await listeners(page, "index:menu-open")).toBe(0);
  expect(await listeners(panel, "index:desktop-open")).toBe(0);
  const saved = await request.post(apiURL + "/api/v1/links", {
    headers: { Authorization: `Bearer ${desktop.token}` },
    data: { url: "https://pages.test/saved-elsewhere", title: "Saved elsewhere" },
  });
  expect(saved.ok()).toBe(true);
  await row.evaluate((el) => ((el as any).kept = true));
  await panel.evaluate(() => {
    const record = window as any;
    record.animated = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes: any, options: any) {
      record.animated.push({ text: this.textContent, keyframes: JSON.stringify(keyframes) });
      return animate.call(this, keyframes, options);
    };
    (window as any).checked = false;
    new MutationObserver(() => {
      if (document.body.textContent?.includes("Checking your session"))
        (window as any).checked = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  // The host has shown the panel; it refreshes without a checking state, keeping its rows.
  await desktop.emit("index:menu-open", { presented: true }, "menu-bar");
  await expect(
    panel.getByRole("button", { name: "Open Saved elsewhere in browser", exact: true }),
  ).toBeVisible();
  expect(await row.evaluate((el) => (el as any).kept)).toBe(true);
  expect(await panel.evaluate(() => (window as any).checked)).toBe(false);
  // The new row fades in at the top while the rows it moves down glide there.
  const animated = async (text: string, keyframe: string) =>
    (
      await panel.evaluate(() => (window as any).animated as { text: string; keyframes: string }[])
    ).some((call) => call.text.includes(text) && call.keyframes.includes(keyframe));
  expect(await animated("Saved elsewhere", "opacity")).toBe(true);
  expect(await animated("Are.na", "translateY(-34px)")).toBe(true);
  // A removed row fades out where it was, as a copy hidden from assistive technology.
  const removed = await request.delete(apiURL + "/api/v1/links/" + (await saved.json()).id, {
    headers: { Authorization: `Bearer ${desktop.token}` },
  });
  expect(removed.ok()).toBe(true);
  await desktop.emit("index:desktop-data", { revision: desktop.revision, source: "main" });
  await expect(
    panel.getByRole("button", { name: "Open Saved elsewhere in browser", exact: true }),
  ).toHaveCount(0);
  await expect.poll(() => animated("Saved elsewhere", '"opacity":0')).toBe(true);
  await expect(panel.locator("[aria-hidden]", { hasText: "Saved elsewhere" })).toHaveCount(0);
  expect(await row.evaluate((el) => (el as any).kept)).toBe(true);
  // With reduced motion, changes apply at once.
  await panel.emulateMedia({ reducedMotion: "reduce" });
  await panel.evaluate(() => ((window as any).animated = []));
  await request.post(apiURL + "/api/v1/links", {
    headers: { Authorization: `Bearer ${desktop.token}` },
    data: { url: "https://pages.test/saved-calmly", title: "Saved calmly" },
  });
  await desktop.emit("index:desktop-data", { revision: desktop.revision, source: "main" });
  await expect(
    panel.getByRole("button", { name: "Open Saved calmly in browser", exact: true }),
  ).toBeVisible();
  expect(await panel.evaluate(() => (window as any).animated.length)).toBe(0);
  // An opening the host could not show at once checks the session before presenting.
  const before = desktop.commands.length;
  await desktop.emit("index:menu-open", { presented: false }, "menu-bar");
  await expect.poll(() => panel.evaluate(() => (window as any).checked)).toBe(true);
  await expect
    .poll(() => desktop.commands.slice(before).some((c) => c.command === "desktop_panel_ready"))
    .toBe(true);
  await expect(row).toBeVisible();
});

test("menu session clears drafts and links across sign-out and account switching while cleanup stalls", async ({
  page,
  context,
  request,
}) => {
  await request.post(apiURL + "/_test/reset");
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await login(page);
  const panel = await context.newPage();
  await desktop.attach(panel, "menu-bar");
  await panel.goto("/menu-bar");
  await expect(
    panel.getByRole("button", { name: "Open Are.na in browser", exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("textbox", { name: "Add a link to this week" })
    .fill("https://alice-private-draft.example");
  await page.goto("/settings");
  let release!: () => void;
  desktop.stopCleanup = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/login/);
    await expect(
      panel.getByRole("button", { name: "Sign in to Index", exact: true }),
    ).toBeVisible();
    await expect(panel.getByRole("button", { name: /Open .*in browser/ })).toHaveCount(0);
    expect(desktop.token).toBeNull();
  } finally {
    release();
  }
  await login(page, "bob@test.example");
  await expect(panel.getByRole("heading", { level: 1 })).toContainText("Week");
  await expect(panel.getByRole("textbox", { name: "Add a link to this week" })).toHaveValue("");
  await expect(
    panel.getByRole("button", { name: "Open Are.na in browser", exact: true }),
  ).toHaveCount(0);
  // An out-of-order old event must not clear Bob's identity or refetch Alice.
  await desktop.emit("index:desktop-session", { revision: 1, source: "main" });
  await expect(panel.getByRole("textbox", { name: "Add a link to this week" })).toBeVisible();
});

test("menu shell forwards hide/Open/Quit without notification ownership; Settings owns login items", async ({
  page,
  context,
  request,
}) => {
  await request.post(apiURL + "/_test/reset");
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await login(page);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 390, height: 560 });
  await desktop.attach(panel, "menu-bar");
  await panel.goto("/menu-bar");
  await expect(panel.getByRole("heading", { level: 1 })).toContainText("Week");
  await expect(panel.getByRole("checkbox", { name: "Launch at login" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Open Index", exact: true }).click();
  await expect.poll(() => desktop.commands.some((c) => c.command === "desktop_open")).toBe(true);
  await panel.keyboard.press("Escape");
  await expect.poll(() => desktop.hidden).toContain("menu-bar");
  const quit = panel.getByRole("button", { name: "Quit Index", exact: true });
  await expect(quit).toHaveAttribute("aria-keyshortcuts", "Meta+Q");
  await quit.click();
  await expect.poll(() => desktop.quits).toBe(1);
  await panel.getByRole("textbox", { name: "Add a link to this week" }).press("Meta+q");
  await expect.poll(() => desktop.quits).toBe(2);
  expect(
    desktop.commands.filter((c) => c.label === "menu-bar" && c.command.startsWith("notification_")),
  ).toHaveLength(0);
  expect(desktop.commands.some((c) => c.command.startsWith("launch_at_login"))).toBe(false);

  await page.goto("/settings");
  const box = page.getByRole("region", { name: "Launch at login" });
  const checkbox = box.getByRole("checkbox", { name: "Launch at login" });
  await expect(checkbox).not.toBeChecked();
  expect(desktop.commands.some((c) => c.command === "launch_at_login_set")).toBe(false);
  await checkbox.click();
  await expect(
    box.getByText("Approval needed in System Settings.", { exact: false }),
  ).toBeVisible();
  await expect(checkbox).not.toBeChecked();
  await box.getByRole("button", { name: "Open Login Items" }).click();
  desktop.loginState = "enabled";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(checkbox).toBeChecked();
  desktop.loginError = true;
  await checkbox.click();
  await expect(box.getByRole("alert")).toContainText("Could not update Launch at login");
  await expect(checkbox).toBeChecked();
  desktop.loginError = false;
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  desktop.loginState = "unsupported";
  desktop.loginSupported = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(box).toHaveCount(0);
});

test("lost peer events cannot submit an old menu draft using a new account", async ({
  page,
  context,
  request,
}) => {
  await request.post(apiURL + "/_test/reset");
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await login(page);
  const panel = await context.newPage();
  await desktop.attach(panel, "menu-bar");
  await panel.goto("/menu-bar");
  const input = panel.getByRole("textbox", { name: "Add a link to this week" });
  await input.fill("https://pages.test/calm-software");
  desktop.suppressed.add("menu-bar");
  // Reproduce a stalled hidden webview without a focus refresh before its stale action.
  await panel.evaluate(() => {
    window.addEventListener("focus", (event) => event.stopImmediatePropagation(), true);
  });
  await login(page, "bob@test.example");
  const writes: string[] = [];
  panel.on("request", (r) => {
    if (r.url().endsWith("/links/share")) writes.push(r.url());
  });
  await input.evaluate((element) =>
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  await expect(input).toHaveValue("");
  await expect(
    panel.getByRole("button", { name: "Open Are.na in browser", exact: true }),
  ).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test("held auth sign-out clears both windows before revocation and cannot erase a later login", async ({
  page,
  context,
  request,
}) => {
  await request.post(apiURL + "/_test/reset");
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await login(page);
  const panel = await context.newPage();
  await desktop.attach(panel, "menu-bar");
  await panel.goto("/menu-bar");
  await expect(
    panel.getByRole("button", { name: "Open Are.na in browser", exact: true }),
  ).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route("**/api/auth/sign-out", async (route) => {
    started = true;
    await held;
    await route.continue();
  });
  await page.goto("/settings");
  try {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect.poll(() => started).toBe(true);
    await expect(page).toHaveURL(/login/);
    await expect(
      panel.getByRole("button", { name: "Sign in to Index", exact: true }),
    ).toBeVisible();
    expect(desktop.token).toBeNull();
    await login(page, "bob@test.example");
    const bobToken = desktop.token;
    release();
    await expect(panel.getByRole("heading", { level: 1 })).toContainText("Week");
    await expect(
      panel.getByRole("button", { name: "Open Are.na in browser", exact: true }),
    ).toHaveCount(0);
    expect(desktop.token).toBe(bobToken);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
  } finally {
    release();
  }
});

test("a held old notification command cannot stop a new account registration", async ({
  page,
  request,
}) => {
  const fixture = await (await request.post(apiURL + "/_test/reset")).json();
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await login(page);
  await page.goto("/settings");
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  desktop.heldNotification = { command: "notification_stop", revision: desktop.revision, wait };
  try {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/login/);
    await login(page, "bob@test.example");
    await page.goto("/settings");
    await page.getByRole("button", { name: "Enable on this device", exact: true }).click();
    await expect.poll(() => desktop.registeredAccount).toBe(fixture.people.Bob);
    const rejected = desktop.rejectedNotifications;
    release();
    await expect.poll(() => desktop.rejectedNotifications).toBeGreaterThan(rejected);
    expect(desktop.registeredAccount).toBe(fixture.people.Bob);
    await expect(page.getByText("Enabled on this device.", { exact: true })).toBeVisible();
  } finally {
    release();
  }
});

test("restricted menu keeps application data hidden and reflects same-account email verification", async ({
  page,
  context,
  request,
}) => {
  await request.post(apiURL + "/_test/reset");
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await page.goto("/login");
  const panel = await context.newPage();
  await desktop.attach(panel, "menu-bar");
  await panel.goto("/menu-bar");
  const appRequests: string[] = [];
  panel.on("request", (r) => {
    if (r.url().includes("/rpc/v1/")) appRequests.push(r.url());
  });
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Menu reader");
  await page.getByLabel("Username", { exact: true }).fill("menu_reader");
  await page.getByLabel("Email", { exact: true }).fill("menu_reader@example.test");
  await page.getByLabel("Password", { exact: true }).fill("menu-reader-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  expect(appRequests).toHaveLength(0);
  await expect(panel.getByRole("textbox", { name: "Add a link to this week" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Verify in Index" }).click();
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  let code: string | undefined;
  await expect
    .poll(async () => {
      const messages = await (
        await request.get(apiURL + "/_test/mail?email=menu_reader%40example.test")
      ).json();
      code = messages.findLast(
        (message: { purpose: string }) => message.purpose === "verify",
      )?.code;
      return !!code;
    })
    .toBe(true);
  await page.getByLabel("Verification code").fill(code!);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "Add a link to this week" })).toBeVisible();
  // An empty week shows the field and nothing under it.
  await expect(panel.getByText("Loading your links…")).toHaveCount(0);
  await expect(panel.locator(".link-list")).toHaveText("");
});

test("menu retry survives hide/focus with its receipt and never substitutes a deleted destination", async ({
  page,
  context,
  request,
}) => {
  const fixture = await (await request.post(apiURL + "/_test/reset")).json();
  const desktop = new DesktopHarness();
  await desktop.attach(page, "main");
  await login(page);
  const panel = await context.newPage();
  await desktop.attach(panel, "menu-bar");
  await panel.goto("/menu-bar");
  await panel.getByRole("button", { name: "Save destination: Your links" }).click();
  await panel.getByRole("menuitemradio", { name: "Notes, only you", exact: true }).click();
  const receipts: string[] = [];
  await panel.route("**/rpc/v1/links/share", async (route) => {
    receipts.push(route.request().postDataJSON().json.requestId);
    if (receipts.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  const input = panel.getByRole("textbox", { name: "Add a link to this week" });
  await add(panel, "https://pages.test/calm-software");
  await expect(input).toHaveValue("https://pages.test/calm-software");
  await expect(panel.getByRole("alert")).toBeVisible();
  await input.blur();
  await panel.keyboard.press("Escape");
  await expect.poll(() => desktop.hidden).toContain("menu-bar");
  await desktop.emit("index:menu-open", { presented: false }, "menu-bar");
  await expect(input).toHaveValue("https://pages.test/calm-software");
  await expect(input).toBeEnabled();
  await input.press("Enter");
  await expect(
    panel.getByRole("button", { name: "Open Calm Software in browser", exact: true }),
  ).toHaveCount(1);
  await expect.poll(() => receipts.length).toBe(2);
  expect(receipts[0]).toBe(receipts[1]);
  await input.fill("https://pages.test/unsaved-private-draft");
  const removed = await request.delete(apiURL + `/api/v1/groups/${fixture.notes.id}`, {
    headers: { Authorization: `Bearer ${desktop.token}` },
    data: { deleteLinks: false },
  });
  expect(removed.ok()).toBe(true);
  await desktop.emit("index:desktop-data", { revision: desktop.revision, source: "main" });
  await expect(
    panel.getByRole("button", { name: "Save destination: Unavailable group" }),
  ).toBeVisible();
  await expect(input).toBeDisabled();
  await expect(input).toHaveValue("https://pages.test/unsaved-private-draft");
  await expect.poll(() => receipts.length).toBe(2);
});
