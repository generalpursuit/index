import { apiURL } from "./urls";
import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}

/** A tiny real PNG, so the browser can decode, square and shrink it. */
const photo =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGPwSDcGIgYIBQAZGgOJs/X2EQAAAABJRU5ErkJggg==";

test.beforeEach(async ({ request }) => {
  await request.post(apiURL + "/_test/reset");
});

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`settings edits and signs out at ${viewport.width}px`, async ({ page }) => {
    // The same page: larger screens open it from the foot of the rail, phones from the
    // profile's gear, with Back to the profile.
    const phone = viewport.width <= 700;
    await page.setViewportSize(viewport);
    await login(page);
    const leave = () =>
      phone
        ? page.getByRole("button", { name: "Back", exact: true }).click()
        : page.getByRole("link", { name: "Your profile", exact: true }).click();
    const font = await page
      .getByRole("heading", { level: 1 })
      .evaluate((h) => getComputedStyle(h).fontFamily);
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Your profile", exact: true }).click();
    const profileURL = page.url();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit profile", exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toHaveCSS(
      "font-family",
      font,
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(
      phone ? 1 : 0,
    );
    // Settings shows who you are; name, username and photo are edited in one modal.
    await expect(page.locator(".settings-identity strong")).toHaveText("Alice");
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByLabel("Bio", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(1);
    // Compare rendered CSS geometry: headed emulation can round a requested 390px to 391px.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
    await page.screenshot({ path: `test-results/settings-${viewport.width}.png` });
    await leave();
    await expect(page).toHaveURL(profileURL);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Edit profile", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit profile" });
    await editor.getByLabel("Name", { exact: true }).fill("Alice Updated");
    await editor.getByLabel("Username", { exact: true }).fill("Alice_Updated");
    // A real photo: it is squared and shrunk in the browser, then uploaded.
    await editor.locator('input[type="file"]').setInputFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from(photo, "base64"),
    });
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit profile", exact: true })).toBeFocused();
    const stored = new RegExp(
      apiURL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/media/avatars/.+\\.(webp|jpg)$",
    );
    await expect(page.locator(".settings-identity strong")).toHaveText("Alice Updated");
    await expect(page.locator(".settings-profile img")).toHaveAttribute("src", stored);
    await page.reload();
    await expect(page.locator(".settings-identity")).toContainText("alice_updated");
    await expect(page.locator(".settings-profile img")).toHaveAttribute("src", stored);
    await leave();
    await expect(page.locator(".profile-heading h1")).toHaveText("Alice Updated");
    await expect(page.locator(".profile-meta")).toContainText("alice_updated");
    await expect(page.locator(".profile-heading img")).toHaveAttribute("src", stored);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Edit profile", exact: true }).click();
    await editor.getByRole("button", { name: "Remove photo", exact: true }).click();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    // Closing a sheet restores focus and can scroll the page on a later frame. Wait for
    // that restoration before clicking the footer's Sign out.
    await expect(page.getByRole("button", { name: "Edit profile", exact: true })).toBeFocused();
    await expect(page.locator(".settings-profile img")).toHaveCount(0);
    const profile = await (await page.request.get(apiURL + "/api/v1/me/profile")).json();
    expect(profile.name).toBe("Alice Updated");
    expect(profile.username).toBe("alice_updated");
    expect(profile.image).toBeNull();
    expect(profile).not.toHaveProperty("bio");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/login/);
    await page.goto(profileURL);
    await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
    await page.goto("/settings");
    await expect(page).toHaveURL(/login.*next=%2Fsettings/);
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toHaveCount(0);
  });
}

for (const viewport of [
  { width: 1440, height: 420 },
  { width: 390, height: 420 },
]) {
  test(`a short window scrolls the editor between its fixed title and actions at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await login(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Edit profile", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit profile" });
    await expect(editor.getByLabel("Name", { exact: true })).toBeVisible();
    // Settled: a sheet mounts in its starting style, off screen, and slides in a frame later.
    await expect
      .poll(() =>
        editor.evaluate(
          (el) =>
            el.hasAttribute("data-starting-style") ||
            el.getAnimations().some((a) => a.playState === "running"),
        ),
      )
      .toBe(false);
    const title = editor.getByRole("heading", { name: "Edit profile", exact: true });
    const save = editor.getByRole("button", { name: "Save", exact: true });
    // Sticky placement can land on a fractional pixel once the body scrolls.
    const place = async () => {
      const [heading, action] = [(await title.boundingBox())!, (await save.boundingBox())!];
      return [Math.round(heading.y), Math.round(action.y + action.height)];
    };
    const before = await place();
    const scrolled = await editor.locator('[data-slot="modal-body"]').evaluate((body) => {
      body.scrollTop = body.scrollHeight;
      return body.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);
    expect(await place()).toEqual(before);
    const frame = (await editor.boundingBox())!;
    expect(before[1]).toBeLessThanOrEqual(Math.round(frame.y + frame.height));
  });
}

test("settings retains edits across validation, save and sign-out failures", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit profile" });
  await editor.getByLabel("Name", { exact: true }).fill("Keep this name");
  await editor.getByLabel("Username", { exact: true }).fill("not a username");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByLabel("Username", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await editor.getByLabel("Username", { exact: true }).fill("alice");
  await page.route("**/rpc/v1/profiles/update", (route) => route.abort("failed"));
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByRole("alert")).toBeVisible();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Keep this name");
  await page.unroute("**/rpc/v1/profiles/update");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator(".settings-identity strong")).toHaveText("Keep this name");
  await page.route("**/api/auth/sign-out", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Try signing out again." }),
    }),
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".settings-sign-out-error")).toContainText("Try signing out again.");
  await expect(page).toHaveURL(/\/settings$/);
  await page.unroute("**/api/auth/sign-out");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/login/);
});

test("settings is private and opens on its own in a fresh tab", async ({
  page,
  context,
  request,
}) => {
  const fixture = await (await request.get(apiURL + "/_test/fixture")).json();
  await page.goto("/settings");
  await expect(page).toHaveURL(/login.*next=%2Fsettings/);
  await login(page);
  await page.goto("/people/" + fixture.people.Bob);
  await expect(page.locator(".profile-heading h1")).toHaveText("Bob");
  // Someone else's profile has no Settings of its own; the rail's stays yours.
  await expect(
    page.locator(".profile-heading").getByRole("link", { name: "Settings", exact: true }),
  ).toHaveCount(0);
  const fresh = await context.newPage();
  await fresh.goto("/settings");
  await expect(fresh.locator(".settings-identity strong")).toHaveText("Alice");
  await expect(fresh.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
  await fresh.getByRole("link", { name: "Your profile", exact: true }).click();
  await expect(fresh).toHaveURL(/\/u\/alice/);
  await fresh.close();
});
