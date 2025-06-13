import { expect, Page } from "@playwright/test";

export const login = async (page: Page, email: string, password = "admin") => {
  await page.getByRole("button", { name: "Sign in with" }).click();
  await page.waitForURL((url) => url.pathname.includes("auth"));
  await page.getByRole("textbox", { name: "email address" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("textbox", { name: "Password" }).press("Enter");
  await page.getByRole("button", { name: "Grant Access" }).click();
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
