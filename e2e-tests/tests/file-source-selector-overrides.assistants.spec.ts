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

test.describe("Assistant file source selector overrides", () => {
  test("shows default assistant file source selector behavior", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as Window & { SHAREPOINT_ENABLED?: boolean }).SHAREPOINT_ENABLED =
        true;
    });

    const assistantName = buildAssistantName("FileSelector-default");
    await createAssistantAndOpenChat(page, assistantName);

    await expect(
      page.getByRole("button", { name: /upload from computer/i }),
    ).toHaveCount(0);
  });

  test("shows override assistant file source selector with variant", async ({
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

    const assistantName = buildAssistantName("FileSelector-override");
    await createAssistantAndOpenChat(page, assistantName);

    await expect(
      page.getByRole("button", { name: /upload from computer/i }),
    ).toBeVisible();
  });
});
