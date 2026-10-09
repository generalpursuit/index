import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Week");
}

test.beforeEach(async ({ request }) => {
  await request.post("http://localhost:3002/_test/reset");
});

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`settings edits and signs out from the profile gear at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await login(page);
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
    await expect(page.getByRole("textbox")).toHaveCount(3);
    await expect(page.getByLabel("Bio", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    await page.screenshot({ path: `test-results/settings-${viewport.width}.png` });
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page).toHaveURL(profileURL);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Alice Updated");
    await page.getByLabel("Username", { exact: true }).fill("Alice_Updated");
    const image = "https://images.example.test/alice.svg";
    await page.route(image, (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#486733"/></svg>',
      }),
    );
    await page.getByLabel("Image URL", { exact: true }).fill(image);
    await expect(page.locator(".settings-photo img")).toHaveAttribute("src", image);
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Alice Updated");
    await expect(page.getByLabel("Username", { exact: true })).toHaveValue("alice_updated");
    await expect(page.getByLabel("Image URL", { exact: true })).toHaveValue(image);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.locator(".profile-heading h1")).toHaveText("Alice Updated");
    await expect(page.locator(".profile-meta")).toContainText("alice_updated");
    await expect(page.locator(".profile-heading img")).toHaveAttribute("src", image);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Remove photo", exact: true }).click();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.getByLabel("Image URL", { exact: true })).toHaveValue("");
    const profile = await (
      await page.request.get("http://localhost:3002/api/v1/me/profile")
    ).json();
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

test("settings retains edits across validation, save and sign-out failures", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  await page.getByLabel("Name", { exact: true }).fill("Keep this name");
  await page.getByLabel("Username", { exact: true }).fill("not a username");
  await page.getByLabel("Image URL", { exact: true }).fill("file:///avatar.png");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByLabel("Username", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByLabel("Image URL", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByLabel("Username", { exact: true }).fill("alice");
  await page.getByLabel("Image URL", { exact: true }).fill("");
  await page.route("**/rpc/v1/profiles/update", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".settings-form > [role=alert]")).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Keep this name");
  await page.unroute("**/rpc/v1/profiles/update");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await page.route("**/api/auth/sign-out", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Try signing out again." }),
    }),
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".settings-session [role=alert]")).toContainText(
    "Try signing out again.",
  );
  await expect(page).toHaveURL(/\/settings$/);
  await page.unroute("**/api/auth/sign-out");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/login/);
});

test("settings is private and a fresh settings tab goes back to your profile", async ({
  page,
  context,
  request,
}) => {
  const fixture = await (await request.get("http://localhost:3002/_test/fixture")).json();
  await page.goto("/settings");
  await expect(page).toHaveURL(/login.*next=%2Fsettings/);
  await login(page);
  await page.goto("/people/" + fixture.people.Bob);
  await expect(page.locator(".profile-heading h1")).toHaveText("Bob");
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
  const fresh = await context.newPage();
  await fresh.goto("/settings");
  await expect(fresh.getByLabel("Name", { exact: true })).toHaveValue("Alice");
  await fresh.getByRole("button", { name: "Back", exact: true }).click();
  await expect(fresh).toHaveURL(new RegExp("/people/" + fixture.people.Alice));
  await fresh.close();
});
