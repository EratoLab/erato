import { expect, test } from "@playwright/test";

test.describe("Chat file source selector overrides", () => {
  // Without cloud providers (none are configured in this scenario) or a
  // registry override, the app renders the plain upload button rather than a
  // source selector; the cloud-provider default selector is only reachable in
  // the entra-id scenario.
  test("falls back to the plain upload button without providers or overrides", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("textbox", { name: /type a message/i }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Upload Files" }),
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
