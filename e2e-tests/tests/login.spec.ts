import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { login } from "./shared";

test("Can login", { tag: TAG_CI }, async ({ browser }) => {
  // Use a fresh context without saved auth state for login testing
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();

  await page.goto("/");
  await login(page, "admin@example.com");

  await expect(
    page.getByRole("textbox", { name: "Type a message..." }),
  ).toBeVisible();

  await context.close();
});

test("Can logout", { tag: TAG_CI }, async ({ page }) => {
  // This test starts with authenticated state and tests logout
  await page.goto("/");

  await expect(
    page.getByRole("textbox", { name: "Type a message..." }),
  ).toBeVisible();

  await page.getByRole("button", { name: "expand sidebar" }).click();
  await page.locator("button").filter({ hasText: "A" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await expect(
    page.getByRole("button", { name: "Sign in with" }),
  ).toBeVisible();
});
