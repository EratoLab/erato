import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";

test(
  "Model selector shows many models and allows selection",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.goto("/");

    const modelSelectorButton = page.locator(
      'button[aria-controls="model-selector-dropdown"]',
    );
    await expect(modelSelectorButton).toBeVisible();

    await modelSelectorButton.click();

    const menu = page.locator("#model-selector-dropdown");
    await expect(menu).toBeVisible();

    const menuItems = menu.getByRole("menuitem");
    await expect(menuItems).toHaveCount(4);

    const targetModel = "GPT-4.1 Mini";
    await page.getByRole("menuitem", { name: targetModel }).click();
    await expect(modelSelectorButton).toContainText(targetModel);
  },
);
