import { test, expect } from "@playwright/test";
import Sharp from "sharp";
import { TAG_CI } from "./tags";
import { login } from "./shared";

/**
 * Analyzes a screenshot buffer to determine if it shows a light or dark theme
 * @param {Buffer} screenshotBuffer - The buffer containing the screenshot
 * @returns {Promise<{theme: string, brightness: number, confidence: number}>}
 */
async function analyzeThemeFromScreenshot(screenshotBuffer) {
  // Use sharp to get pixel data
  const { data, info } = await Sharp(screenshotBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;

  // Sample pixels from the image (avoiding edges)
  const sampleSize = 100; // Number of sample points
  const borderMargin = 0.1; // Avoid sampling 10% from each edge

  let totalBrightness = 0;
  let sampleCount = 0;

  for (let i = 0; i < sampleSize; i++) {
    // Generate random coordinates within the central area of the image
    const x = Math.floor(
      width * (borderMargin + Math.random() * (1 - 2 * borderMargin)),
    );
    const y = Math.floor(
      height * (borderMargin + Math.random() * (1 - 2 * borderMargin)),
    );

    // Calculate pixel position in the buffer
    const pixelPos = (y * width + x) * channels;

    // Get RGB values (assuming RGB or RGBA format)
    const r = data[pixelPos];
    const g = data[pixelPos + 1];
    const b = data[pixelPos + 2];

    // Calculate perceived brightness using the weighted formula
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;

    totalBrightness += brightness;
    sampleCount++;
  }

  // Calculate average brightness (0-255)
  const averageBrightness = totalBrightness / sampleCount;

  // Threshold for dark/light determination (0-255)
  const threshold = 128;

  return {
    theme: averageBrightness < threshold ? "dark" : "light",
    brightness: averageBrightness,
    confidence: Math.abs((averageBrightness - threshold) / threshold),
  };
}

const expectIsLightPage = async (
  page,
  expectMessage = "Page should be light",
) => {
  // HACK: Replace with better way to check if rendering is setteled
  await page.waitForTimeout(500);
  const buffer = await page.screenshot();
  const analysisResult = await analyzeThemeFromScreenshot(buffer);
  expect(analysisResult.theme, expectMessage).toBe("light");
};

const expectIsDarkPage = async (
  page,
  expectMessage = "Page should be light",
) => {
  // HACK: Replace with better way to check if rendering is setteled
  await page.waitForTimeout(500);
  const buffer = await page.screenshot();
  const analysisResult = await analyzeThemeFromScreenshot(buffer);
  expect(analysisResult.theme, expectMessage).toBe("dark");
};

test(
  "Can login and see dark mode by default",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");

    await login(page, "admin@example.com");

    await expect(
      page.getByRole("textbox", { name: "Type a message..." }),
    ).toBeVisible();
    await expectIsDarkPage(page, "Page should be dark by default");
    // Toggle to light and check if it persists after reload
    await page.getByRole("button", { name: "expand sidebar" }).click();
    await page.locator("button").filter({ hasText: "A" }).click();
    await page.getByRole("menuitem", { name: "Light mode" }).click();
    await expectIsLightPage(
      page,
      "Page should switch to light after selecting light mode",
    );
    await page.reload();
    await expectIsLightPage(page, "Page should stay light after reload");
  },
);

test(
  "Can login and see light mode by default",
  { tag: TAG_CI },
  async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");

    await login(page, "admin@example.com");

    await expect(
      page.getByRole("textbox", { name: "Type a message..." }),
    ).toBeVisible();
    await expectIsLightPage(page, "Page should be light by default");
    // Toggle to light and check if it persists after reload
    await page.getByRole("button", { name: "expand sidebar" }).click();
    await page.locator("button").filter({ hasText: "A" }).click();
    await page.getByRole("menuitem", { name: "Dark mode" }).click();
    await expectIsDarkPage(
      page,
      "Page should switch to dark after selecting dark mode",
    );
    await page.reload();
    await expectIsDarkPage(page, "Page should stay dark after reload");
  },
);

test(
  "Can login and see german language by default",
  { tag: TAG_CI },
  async ({ browser }) => {
    const context = await browser.newContext({
      locale: "de-DE",
    });
    const page = await context.newPage();
    await page.goto("/");

    await login(page, "admin@example.com");

    await expect(
      page.getByRole("textbox", { name: "Nachricht eingeben..." }),
    ).toBeVisible();
  },
);
