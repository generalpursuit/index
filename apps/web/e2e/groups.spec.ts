import { test, expect, type Page } from "@playwright/test";
import { apiURL } from "./urls";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.beforeEach(async ({ request }) => {
  await request.post(apiURL + "/_test/reset");
});
// A page asks in a dialog; inside a modal, such as Edit group, it asks in place.
const question = (page: Page, title: string) =>
  page
    .getByRole("alertdialog", { name: title, exact: true })
    .or(
      page
        .locator(".confirmation-in-place")
        .filter({ has: page.getByText(title, { exact: true }) }),
    );

for (const scheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`group create, cancel, privacy and edit at ${width}px in ${scheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
      await page.addInitScript((theme) => localStorage.setItem("index.theme", theme), scheme);
      await login(page);
      await page.goto("/settings");
      const trigger = page.getByRole("button", { name: "New group", exact: true });
      await trigger.click();
      const form = page.getByRole("dialog", { name: "New group", exact: true });
      const input = form.getByRole("textbox", { name: "Name", exact: true });
      const lock = form.getByRole("button", { name: "Lock group", exact: true });
      // A phone sheet receives focus without opening the software keyboard.
      await expect(width === 390 ? form : input).toBeFocused();
      await expect(lock).toHaveAttribute("aria-pressed", "false");
      await expect(form.getByText("Visible to anyone who can see your profile.")).toBeVisible();
      await expect(form.getByRole("radio")).toHaveCount(0);
      await expect(form.getByRole("combobox")).toHaveCount(0);
      await expect(form.getByRole("button", { name: "Create", exact: true })).toHaveCount(1);
      const geometry = await form.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          sheet: element.classList.contains("app-sheet"),
          left: rect.left,
          right: rect.right,
          client: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
        };
      });
      expect(geometry.sheet).toBe(width === 390);
      expect(geometry.scroll).toBe(geometry.client);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.client);
      await input.fill("Discard me");
      await form.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(form).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await input.fill("Escape discards this");
      await page.keyboard.press("Escape");
      await expect(form).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await expect(input).toHaveValue("");
      await form.getByRole("button", { name: "Create", exact: true }).click();
      await expect(form.getByRole("alert")).toHaveText("Give the group a name.");
      await expect(input).toBeFocused();
      await input.fill("  Weekend   reads  ");
      // Keyboard toggling does not submit the form.
      await lock.focus();
      await page.keyboard.press("Space");
      await expect(lock).toHaveAttribute("aria-pressed", "true");
      await expect(form.getByText("Only you can see this group and its links.")).toBeVisible();
      await page.screenshot({ path: `test-results/groups-${width}-${scheme}.png` });
      await input.press("Enter");
      await expect(form).toHaveCount(0);
      const row = page
        .locator(".settings-group")
        .filter({ has: page.getByText("Weekend reads", { exact: true }) });
      const rowLock = row.getByRole("button", { name: "Lock Weekend reads", exact: true });
      await expect(rowLock).toHaveAttribute("aria-pressed", "true");
      await rowLock.click();
      const confirm = question(page, "Unlock group?");
      await expect(confirm).toContainText("Visible to anyone who can see your profile.");
      await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(rowLock).toHaveAttribute("aria-pressed", "true");
      await rowLock.click();
      await confirm.getByRole("button", { name: "Unlock group", exact: true }).click();
      await expect(rowLock).toHaveAttribute("aria-pressed", "false");
      await row.getByRole("button", { name: "Actions for Weekend reads", exact: true }).click();
      await page.getByRole("menuitem", { name: "Edit group", exact: true }).click();
      const edit = page.getByRole("dialog", { name: "Edit group", exact: true });
      await edit.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(edit).toHaveCount(0);
      const editTrigger = row.getByRole("button", {
        name: "Actions for Weekend reads",
        exact: true,
      });
      await expect(editTrigger).toBeFocused();
      await editTrigger.click();
      await page.getByRole("menuitem", { name: "Edit group", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(edit).toHaveCount(0);
      await expect(editTrigger).toBeFocused();
      await editTrigger.click();
      await page.getByRole("menuitem", { name: "Edit group", exact: true }).click();
      await edit.getByLabel("Name", { exact: true }).fill("Weekend reading");
      await edit.getByRole("button", { name: "Lock group", exact: true }).click();
      await edit.getByRole("button", { name: "Save", exact: true }).click();
      // Inside the Edit group modal the question takes the place of its actions.
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await question(page, "Lock group?").getByRole("button", { name: "Cancel" }).click();
      await expect(edit.getByLabel("Name", { exact: true })).toHaveValue("Weekend reading");
      await edit.getByRole("button", { name: "Save", exact: true }).click();
      await question(page, "Lock group?").getByRole("button", { name: "Lock and save" }).click();
      await expect(edit).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Lock Weekend reading", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      // Favorites and Starred come first, without a lock or actions; your groups follow.
      const names = page.locator(".settings-group-name");
      await expect(names.nth(0)).toHaveText("Favorites");
      await expect(names.nth(1)).toHaveText("Starred");
      await expect(names.filter({ hasText: "Weekend reading" })).toHaveCount(1);
      for (const name of ["Favorites", "Starred"]) {
        const pinned = page
          .locator(".settings-group")
          .filter({ has: page.getByText(name, { exact: true }) });
        await expect(pinned.getByRole("button")).toHaveCount(0);
      }
    });
  }
}

test("group validation includes reserved, normalized names, slug history and retryable errors", async ({
  page,
}) => {
  await login(page);
  // Leave a historical alias that must remain unavailable after rename.
  const response = await page.request.post(apiURL + "/api/v1/groups", {
    data: { name: "Old address" },
  });
  const group = await response.json();
  expect(response.ok()).toBeTruthy();
  expect(
    (
      await page.request.patch(apiURL + `/api/v1/groups/${group.id}`, {
        data: { name: "New address" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/settings");
  await page.getByRole("button", { name: "New group", exact: true }).click();
  const form = page.getByRole("dialog", { name: "New group", exact: true });
  const input = form.getByLabel("Name", { exact: true });
  const create = form.getByRole("button", { name: "Create", exact: true });
  await input.fill("ＦＡＶＯＲＩＴＥＳ!");
  await create.click();
  await expect(form.getByRole("alert")).toHaveText("This group name is reserved.");
  await input.fill("ﬃ".repeat(34));
  await create.click();
  await expect(form.getByRole("alert")).toHaveText("Use 100 characters or fewer.");
  for (const name of ["rEaDiNg", "Reading!", "Old address"]) {
    await input.fill(name);
    await create.click();
    await expect(form.getByRole("alert")).toContainText("already reserved");
    await expect(input).toHaveValue(name);
    await expect(input).toHaveAttribute("aria-invalid", "true");
  }
  await input.fill("Retry this group");
  await form.getByRole("button", { name: "Lock group", exact: true }).click();
  await page.route("**/rpc/v1/groups/create", (route) => route.abort("failed"));
  await create.click();
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(input).toHaveValue("Retry this group");
  await expect(form.getByRole("button", { name: "Lock group", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.unroute("**/rpc/v1/groups/create");
  await create.click();
  await expect(form).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Lock Retry this group", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

for (const width of [1440, 390]) {
  test(`profile cancel focus and pending creation at ${width}px selects returned group`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await login(page);
    await page.goto("/u/alice");
    const lists = page.getByRole("navigation", { name: "Lists" });
    const add = lists.getByRole("button", { name: "New group", exact: true });
    await add.click();
    const form = page.getByRole("dialog", { name: "New group", exact: true });
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(add).toBeFocused();
    await add.click();
    await page.keyboard.press("Escape");
    await expect(form).toHaveCount(0);
    await expect(add).toBeFocused();
    await add.click();
    await form.getByLabel("Name", { exact: true }).fill("Chosen automatically");
    let attempts = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/rpc/v1/groups/create", async (route) => {
      attempts++;
      await held;
      await route.continue();
    });
    await form.getByRole("button", { name: "Create", exact: true }).click();
    await expect(form.getByRole("button", { name: "Creating…", exact: true })).toBeDisabled();
    await expect(form.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(form).toBeVisible();
    expect(attempts).toBe(1);
    release();
    await expect(form).toHaveCount(0);
    await expect(page).toHaveURL(/\/u\/alice\/chosen-automatically$/);
    await expect(
      lists.getByRole("link", { name: "Chosen automatically", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: /^Save destination:/ })).toHaveAccessibleName(
      "Save destination: Chosen automatically",
    );
  });
}

test("Edit group waits for its question, so it saves what it asked about", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Actions for Notes", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit group", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit group", exact: true });
  const lock = edit.getByRole("button", { name: "Lock group", exact: true });
  await expect(lock).toHaveAttribute("aria-pressed", "true");
  await lock.click();
  await edit.getByRole("button", { name: "Save", exact: true }).click();
  const ask = question(page, "Unlock group?");
  await expect(ask.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  // Relocking while the question is open does nothing: the form waits for the answer.
  await lock.click({ force: true });
  await expect(lock).toHaveAttribute("aria-pressed", "false");
  await edit.getByLabel("Name", { exact: true }).click({ force: true });
  await expect(ask.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await ask.getByRole("button", { name: "Unlock and save", exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Lock Notes", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
test("management errors preserve privacy and edits without overflowing phone settings", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const name = "x".repeat(100);
  const created = await page.request.post(apiURL + "/api/v1/groups", { data: { name } });
  expect(created.ok()).toBeTruthy();
  await page.goto("/settings");
  const row = page
    .locator(".settings-group")
    .filter({ has: page.getByText(name, { exact: true }) });
  const lock = row.getByRole("button", { name: `Lock ${name}`, exact: true });
  await page.route("**/rpc/v1/groups/update", (route) => route.abort("failed"));
  await lock.click();
  await question(page, "Lock group?")
    .getByRole("button", { name: "Lock group", exact: true })
    .click();
  await expect(row.getByRole("alert")).toBeVisible();
  await expect(lock).toHaveAttribute("aria-pressed", "false");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth === document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const bounds = await row.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await page.unroute("**/rpc/v1/groups/update");
  await lock.click();
  await question(page, "Lock group?")
    .getByRole("button", { name: "Lock group", exact: true })
    .click();
  await expect(lock).toHaveAttribute("aria-pressed", "true");
  const editTrigger = row.getByRole("button", { name: `Actions for ${name}`, exact: true });
  await editTrigger.click();
  await page.getByRole("menuitem", { name: "Edit group", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit group", exact: true });
  await edit.getByLabel("Name", { exact: true }).fill("rEaDiNg");
  await edit.getByRole("button", { name: "Save", exact: true }).click();
  await expect(edit.getByRole("alert")).toContainText("already reserved");
  await expect(edit.getByLabel("Name", { exact: true })).toHaveValue("rEaDiNg");
  await edit.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editTrigger).toBeFocused();
  await editTrigger.click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const confirm = question(page, "Delete group?");
  await expect(confirm).toContainText("They will no longer be locked");
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row).toBeVisible();
});
