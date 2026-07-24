import { expect, test } from "@playwright/test";

test.describe("Chat file source selector overrides", () => {
  test("shows default chat file source selector behavior", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("textbox", { name: /type a message/i }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: /upload from computer/i }),
    ).toHaveCount(0);
  });

  test("shows override chat file source selector with variant", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (
        window as Window & { __E2E_COMPONENT_VARIANT__?: string }
      ).__E2E_COMPONENT_VARIANT__ = "welcome-screen-example";
    });

    await page.goto("/");

    await expect(
      page.getByRole("button", { name: /upload from computer/i }),
    ).toBeVisible();
  });
});
