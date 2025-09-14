import { test as setup, expect } from "@playwright/test";
import { login } from "./shared";

const authFile = "playwright/.auth/user.json";

setup("authenticate", async ({ page }) => {
  // Perform authentication steps
  await page.goto("/");
  await login(page, "admin@example.com");

  // Wait until the page receives the cookies
  await expect(
    page.getByRole("textbox", { name: "Type a message..." }),
  ).toBeVisible();

  // End of authentication steps
  await page.context().storageState({ path: authFile });
});
