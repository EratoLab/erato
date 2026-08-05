import { expect, test } from "@playwright/test";
import { TAG_CI } from "./tags";
import { gotoAppPage } from "./shared";

test(
  "missing assets are not rewritten to the SPA document",
  { tag: TAG_CI },
  async ({ page }) => {
    const response = await page.request.get("/chat/missing.js");

    expect(response.status()).toBe(404);
  },
);

test(
  "office add-in pages are served when the bundle is enabled",
  { tag: TAG_CI },
  async ({ page }) => {
    const officeAddinBasePath = "/public/platform-office-addin";
    const officeAddinResponse = await page.request.get(
      `${officeAddinBasePath}/`,
    );

    if (officeAddinResponse.status() === 404) {
      test.skip(true, "The Office add-in bundle is not enabled");
      return;
    }

    expect(officeAddinResponse.status()).toBe(200);
    await gotoAppPage(page, `${officeAddinBasePath}/`);
    await gotoAppPage(page, `${officeAddinBasePath}/setup`);
  },
);
