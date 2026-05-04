import { expect, Page, test } from "@playwright/test";
import { TAG_CI } from "./tags";
import { chatIsReadyToChat } from "./shared";

const selectMockModel = async (page: Page) => {
  const modelSelectorButton = page.locator(
    'button[aria-controls="model-selector-dropdown"]',
  );
  await expect(modelSelectorButton).toBeVisible();
  await modelSelectorButton.click();
  await page.getByRole("menuitem", { name: "Mock-LLM", exact: true }).click();
  await expect(modelSelectorButton).toContainText("Mock-LLM");
};

test.skip(
  "Audio transcription blocks sending until complete in many-models",
  { tag: TAG_CI },
  async ({ page }) => {
    const submitstreamRequests: string[] = [];
    await page.route("**/api/v1beta/me/messages/submitstream*", async (route) => {
      submitstreamRequests.push(route.request().url());
      await route.continue();
    });

    await page.route("**/api/v1beta/me/files*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          files: [
            {
              id: "audio-test-file",
              filename: "interview-recording.mp3",
              download_url: "/files/audio-test-file",
              file_contents_unavailable_missing_permissions: false,
              file_capability: {
                extensions: ["mp3"],
                id: "audio",
                mime_types: ["audio/mpeg"],
                operations: ["extract_text"],
              },
              audio_transcription: {
                status: "processing",
              },
            },
          ],
        }),
      });
    });

    await page.goto("/");
    await chatIsReadyToChat(page);
    await selectMockModel(page);

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /upload files/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "interview-recording.mp3",
      mimeType: "audio/mpeg",
      buffer: Buffer.from("fake audio content"),
    });

    await expect(page.getByTestId("chat-audio-transcription-blocker")).toBeVisible();
    await expect(page.getByText("interview-recording.mp3")).toBeVisible();
    await expect(page.getByTestId("chat-input-send-message")).toBeDisabled();

    const textbox = page.getByRole("textbox", {
      name: "Type a message...",
    });
    await expect(textbox).toBeVisible();
    await textbox.fill("Can you summarize this audio?");
    await textbox.press("Enter");

    await expect(
      page.getByTestId("chat-audio-transcription-blocker"),
    ).toBeVisible();

    expect(submitstreamRequests).toHaveLength(0);
  },
);
