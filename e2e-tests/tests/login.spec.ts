import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { login } from "./shared";

test("Can login", { tag: TAG_CI }, async ({ page }) => {
  await page.goto("/");

  await login(page, "admin@example.com");

  await expect(
    page.getByRole("textbox", { name: "Type a message..." }),
  ).toBeVisible();
});

test("Can logout", { tag: TAG_CI }, async ({ page }) => {
  await page.goto("/");

  await login(page, "admin@example.com");

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
