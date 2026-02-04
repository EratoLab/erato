import { expect, test, type Page } from "@playwright/test";

const createAssistantAndOpenChat = async (
  page: Page,
  assistantName: string,
) => {
  await page.goto("/assistants/new");

  await expect(
    page.getByRole("heading", { name: /create assistant/i }),
  ).toBeVisible();

  await page.getByLabel(/name/i).fill(assistantName);
  await page.getByLabel(/system prompt/i).fill("You are a helpful assistant.");
  await page.getByRole("button", { name: /create assistant/i }).click();

  await expect(page.getByText(/assistant created successfully/i)).toBeVisible({
    timeout: 5000,
  });
  await page.waitForURL("/assistants", { timeout: 5000 });

  const assistantButton = page.getByRole("button", {
    name: new RegExp(assistantName),
  });
  await expect(assistantButton).toBeVisible();
  await assistantButton.click();

  await expect(
    page.getByRole("textbox", { name: /type a message/i }),
  ).toBeVisible();
};

const buildAssistantName = (prefix: string) => {
  const randomSuffix = Math.floor(Math.random() * 16777215)
    .toString(16)
    .padStart(6, "0");
  return `${prefix}-${randomSuffix}`;
};

test.describe("Assistant welcome screen overrides", () => {
  test("shows default assistant welcome screen", async ({ page }) => {
    const assistantName = buildAssistantName("Welcome-default");
    await createAssistantAndOpenChat(page, assistantName);

    await expect(
      page.getByTestId("assistant-welcome-screen-default"),
    ).toBeVisible();
  });

  test("shows override assistant welcome screen with variant", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (
        window as Window & { __E2E_COMPONENT_VARIANT__?: string }
      ).__E2E_COMPONENT_VARIANT__ = "welcome-screen-example";
    });

    const assistantName = buildAssistantName("Welcome-override");
    await createAssistantAndOpenChat(page, assistantName);

    await expect(
      page.getByTestId("assistant-welcome-screen-example"),
    ).toBeVisible();
  });
});
