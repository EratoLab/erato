import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";

// Needs to be implemented
test.skip(
  "Can open new chat page and input is focused",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
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
    await expect(
      page.getByRole("textbox", { name: "Type a message..." }),
    ).toBeFocused();
  },
);
