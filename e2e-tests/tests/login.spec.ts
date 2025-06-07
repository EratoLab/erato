import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";

test("Can login", { tag: TAG_CI }, async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Sign in with" }).click();
  await page.waitForURL((url) => url.pathname.includes("auth"));
  // await page.getByRole('textbox', { name: 'email address' }).click();
  await page
    .getByRole("textbox", { name: "email address" })
    .fill("admin@example.com");
  await page.getByRole("textbox", { name: "Password" }).fill("admin");
  await page.getByRole("textbox", { name: "Password" }).press("Enter");
  await page.getByRole("button", { name: "Grant Access" }).click();

  await expect(
    page.getByRole("textbox", { name: "Type a message..." }),
  ).toBeVisible();
});

test("Can logout", { tag: TAG_CI }, async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Sign in with" }).click();
  await page.waitForURL((url) => url.pathname.includes("auth"));
  await page
    .getByRole("textbox", { name: "email address" })
    .fill("admin@example.com");
  await page.getByRole("textbox", { name: "Password" }).fill("admin");
  await page.getByRole("textbox", { name: "Password" }).press("Enter");
  await page.getByRole("button", { name: "Grant Access" }).click();

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
