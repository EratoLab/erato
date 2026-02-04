import { expect, test } from "@playwright/test";

const enableSharepoint = async (page: { addInitScript: Function }) => {
  await page.addInitScript(() => {
    (window as Window & { SHAREPOINT_ENABLED?: boolean }).SHAREPOINT_ENABLED =
      true;
  });
};

test.describe("Chat file source selector overrides", () => {
  test("shows default chat file source selector behavior", async ({ page }) => {
    await enableSharepoint(page);
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
        window as Window & {
          SHAREPOINT_ENABLED?: boolean;
          __E2E_COMPONENT_VARIANT__?: string;
        }
      ).SHAREPOINT_ENABLED = true;
      (
        window as Window & {
          SHAREPOINT_ENABLED?: boolean;
          __E2E_COMPONENT_VARIANT__?: string;
        }
      ).__E2E_COMPONENT_VARIANT__ = "welcome-screen-example";
    });

    await page.goto("/");

    await expect(
      page.getByRole("button", { name: /upload from computer/i }),
    ).toBeVisible();
  });
});
