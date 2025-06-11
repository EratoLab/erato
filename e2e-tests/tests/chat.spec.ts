import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";

test(
  "Can upload a file and see it in the UI",
  { tag: TAG_CI },
  async ({ page }) => {
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

    // Start waiting for file chooser before clicking the button
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByLabel("Upload Files").click();
    const fileChooser = await fileChooserPromise;

    const filePath = "test-files/sample-report-compressed.pdf";
    await fileChooser.setFiles(filePath);

    await expect(page.getByText("PDF", { exact: true })).toBeVisible();
    await expect(page.getByText("Attachments")).toBeVisible();
  },
);
