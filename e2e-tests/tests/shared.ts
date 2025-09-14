import { expect, Page, Browser } from "@playwright/test";

export const login = async (page: Page, email: string, password = "admin") => {
  await page.getByRole("button", { name: "Sign in with" }).click();
  await page.waitForURL((url) => url.pathname.includes("auth"));
  await page.getByRole("textbox", { name: "email address" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("textbox", { name: "Password" }).press("Enter");
  await page.getByRole("button", { name: "Grant Access" }).click();
};

/**
 * Creates a new authenticated context for a different user
 * Use this when you need to test with a different user than the default admin@example.com
 */
export const createAuthenticatedContext = async (
  browser: Browser,
  email: string,
  password = "admin",
) => {
  // Create a fresh context without any stored authentication state
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();

  await page.goto("/");
  await login(page, email, password);

  // Wait for successful login
  await expect(
    page.getByRole("textbox", { name: "Type a message..." }),
  ).toBeVisible();

  return { context, page };
};

export const chatIsReadyToChat = async (
  page: Page,
  args?: { expectAssistantResponse?: boolean },
) => {
  const textbox = page.getByRole("textbox", { name: "Type a message..." });
  await expect(textbox).toBeVisible();
  await expect(textbox).toBeEnabled();
  if (args?.expectAssistantResponse) {
    await expect(page.getByText("Assistant")).toBeVisible();
  }
  await expect(page.getByText("Loading")).toHaveCount(0);
};

export const ensureOpenSidebar = async (page: Page) => {
  const expandButton = page.getByLabel("expand sidebar");
  if (await expandButton.isVisible()) {
    await expandButton.click();
  }
};
