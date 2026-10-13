import { test, expect } from "@playwright/test";
import { apiURL } from "./urls";
let fixture: {
  people: Record<string, string>;
  links: { id: string; shortId: string; title: string }[];
  reading: { id: string; slug: string };
  notes: { id: string };
  conversationId: string;
  conversationShortId: string;
};
test.beforeEach(async ({ request }) => {
  fixture = await (await request.post(apiURL + "/_test/reset")).json();
});
async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email or username", { exact: true }).fill("alice");
  await page.getByLabel("Password", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}
test("legacy profile/group/post URLs redirect while retaining settings and post state", async ({
  page,
}) => {
  await login(page);
  await page.goto(
    `/people/${fixture.people.Alice}?group=${fixture.reading.id}&post=${fixture.links[0]!.id}`,
  );
  await expect(page).toHaveURL(new RegExp(`/u/alice/reading\\?post=${fixture.links[0]!.shortId}`));
  await expect(page.getByRole("dialog", { name: "Post", exact: true })).toContainText(
    fixture.links[0]!.title,
  );
  await page.keyboard.press("Escape");
  const lists = page.getByRole("navigation", { name: "Lists" });
  await expect(lists.getByRole("link", { name: "Reading", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await lists.getByRole("link", { name: "Favorites", exact: true }).click();
  await expect(page).toHaveURL(/\/u\/alice\/favorites$/);
  await page.goto(`/people/${fixture.people.Alice}?settings=true`);
  await expect(page).toHaveURL(/\/u\/alice\?settings=true$/);
});
test("short link and conversation addresses resolve legacy IDs and preserve queued attachments", async ({
  page,
}) => {
  await login(page);
  await page.goto(`/links/${fixture.links[0]!.id}`);
  await expect(page).toHaveURL(new RegExp(`/l/${fixture.links[0]!.shortId}$`));
  await expect(
    page.getByRole("heading", { name: fixture.links[0]!.title, exact: true }),
  ).toBeVisible();
  await page.goto(`/messages/${fixture.conversationId}?attach=${fixture.links[0]!.id}`);
  await expect(page).toHaveURL(new RegExp(`/messages/${fixture.conversationShortId}$`));
  await expect(page.locator(".draft-attachment")).toContainText(fixture.links[0]!.title);
});
test("private and unknown addresses do not reveal canonical routes", async ({ page }) => {
  await page.goto(`/u/alice/notes`);
  await expect(page.getByText("Destination not found.", { exact: true })).toBeVisible();
  await expect(page.locator(".profile-identity")).toHaveCount(0);
  await page.goto(`/people/${fixture.people.Alice}?group=${fixture.notes.id}`);
  await expect(page.getByText("Destination not found.", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/people/${fixture.people.Alice}`));
  await page.goto(`/u/alice/starred`);
  await expect(page.getByText("Destination not found.", { exact: true })).toBeVisible();
});
