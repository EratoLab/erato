import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { login } from "./shared";

test(
  "Can open new chat page and input is focused",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");

    await login(page, "admin@example.com");

    await expect(
      page.getByRole("textbox", { name: "Type a message..." }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Type a message..." }),
    ).toBeFocused();
  },
);
