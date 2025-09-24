import { test as setup, expect } from "@playwright/test";
import { login } from "./shared";

const authFile = "playwright/.auth/user.json";

setup("authenticate", async ({ page }) => {
  // Perform authentication steps with increased timeout for CI
  await page.goto("/");
  await login(page, "admin@example.com");

  // Wait until the page receives the cookies with extended timeout for CI
  await expect(
    page.getByRole("textbox", { name: "Type a message..." }),
  ).toBeVisible({ timeout: 15000 });

  // Verify page is actually ready for interaction
  const textbox = page.getByRole("textbox", { name: "Type a message..." });
  await expect(textbox).toBeEnabled({ timeout: 10000 });

  // End of authentication steps
  await page.context().storageState({ path: authFile });
});
