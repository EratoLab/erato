import { expect, test } from "@playwright/test";

test.describe("Chat welcome screen overrides", () => {
  test("shows default chat welcome screen behavior", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("textbox", { name: /type a message/i }),
    ).toBeVisible();

    await expect(page.getByTestId("welcome-screen-example")).toHaveCount(0);
  });

  test("shows override chat welcome screen with variant", async ({ page }) => {
    await page.addInitScript(() => {
      (
        window as Window & { __E2E_COMPONENT_VARIANT__?: string }
      ).__E2E_COMPONENT_VARIANT__ = "welcome-screen-example";
    });

    await page.goto("/");

    await expect(page.getByTestId("welcome-screen-example")).toBeVisible();
  });
});
