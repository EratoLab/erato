import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { chatIsReadyToChat, ensureOpenSidebar } from "./shared";

/**
 * Assistant Navigation State Cleanup Tests
 *
 * Per assistant-chat-entry-points-analysis.md, these entry points need proper cleanup:
 * - FrequentAssistantsList (sidebar) - Currently NO state cleanup
 * - AssistantsListPage (management page) - Currently NO state cleanup
 * - AssistantsPageStructure (layout) - Currently NO state cleanup
 *
 * Without proper cleanup (cleanupForNewConversation), users would experience:
 * - Input locked/disabled when navigating to assistant (stale isStreaming state)
 * - Messages from previous chat appearing in assistant chat
 * - Unable to send messages to assistant immediately
 *
 * IMPORTANT: These tests verify OBSERVABLE BEHAVIOR, not implementation.
 * We don't mock or suppress - we test real user flows.
 */

test.describe("Assistant Navigation State Cleanup", () => {
  // Helper to create a test assistant
  const createTestAssistant = async (page: any, assistantName: string) => {
    await page.goto("/assistants/new");
    await expect(
      page.getByRole("heading", { name: /create assistant/i }),
    ).toBeVisible();

    await page.getByLabel(/name/i).fill(assistantName);
    await page
      .getByLabel(/system prompt/i)
      .fill("You are a helpful test assistant. Keep responses brief.");
    await page.getByRole("button", { name: /create assistant/i }).click();

    await expect(page.getByText(/assistant created successfully/i)).toBeVisible(
      { timeout: 5000 },
    );
    await page.waitForURL("/assistants", { timeout: 5000 });

    return assistantName;
  };

  test.describe("From Regular Chat to Assistant", () => {
    test(
      "Can immediately use assistant after having an active regular chat",
      { tag: TAG_CI },
      async ({ page }) => {
        // This is the key bug scenario - user has a regular chat,
        // then clicks on an assistant. Without cleanup, input might be locked.

        const randomSuffix = Math.floor(Math.random() * 16777215)
          .toString(16)
          .padStart(6, "0");
        const assistantName = `ImmediateUse-${randomSuffix}`;

        // Create assistant first
        await createTestAssistant(page, assistantName);

        // Start a regular chat
        await page.goto("/chat/new");
        await chatIsReadyToChat(page);

        const textbox = page.getByRole("textbox", { name: /type a message/i });
        await textbox.fill("Regular chat message");
        await textbox.press("Enter");
        await chatIsReadyToChat(page, { expectAssistantResponse: true });

        // Now navigate to assistants and click on our assistant
        await page.goto("/assistants");
        await page.waitForTimeout(500);

        const assistantButton = page.getByRole("button", {
          name: new RegExp(assistantName),
        });
        await expect(assistantButton).toBeVisible();
        await assistantButton.click();

        // Wait for assistant chat page
        await expect(
          page.getByRole("textbox", { name: /type a message/i }),
        ).toBeVisible();

        // KEY TESTS:
        // 1. Input should be enabled (not locked by stale streaming state)
        const assistantTextbox = page.getByRole("textbox", {
          name: /type a message/i,
        });
        await expect(assistantTextbox).toBeEnabled();

        // 2. No messages from regular chat should appear
        await expect(page.getByText("Regular chat message")).toHaveCount(0);
        await expect(page.getByTestId("message-user")).toHaveCount(0);

        // 3. Should be able to actually use the assistant
        await assistantTextbox.fill("Hello assistant!");
        await assistantTextbox.press("Enter");
        await chatIsReadyToChat(page, { expectAssistantResponse: true });

        // Verify we got a response
        await expect(page.getByTestId("message-assistant")).toBeVisible();
      },
    );

    test(
      "Messages from regular chat do not appear in assistant chat",
      { tag: TAG_CI },
      async ({ page }) => {
        const randomSuffix = Math.floor(Math.random() * 16777215)
          .toString(16)
          .padStart(6, "0");
        const assistantName = `NoLeak-${randomSuffix}`;
        const regularChatMarker = `REGULAR_${randomSuffix}`;
        const assistantChatMarker = `ASSISTANT_${randomSuffix}`;

        await createTestAssistant(page, assistantName);

        // Create regular chat with identifiable content
        await page.goto("/chat/new");
        await chatIsReadyToChat(page);

        const textbox = page.getByRole("textbox", { name: /type a message/i });
        await textbox.fill(`${regularChatMarker} - write haiku`);
        await textbox.press("Enter");
        await chatIsReadyToChat(page, { expectAssistantResponse: true });

        // Verify marker is visible in regular chat
        await expect(page.getByText(regularChatMarker)).toBeVisible();

        // Navigate to assistant
        await page.goto("/assistants");
        await page.waitForTimeout(500);

        const assistantButton = page.getByRole("button", {
          name: new RegExp(assistantName),
        });
        await assistantButton.click();
        await chatIsReadyToChat(page);

        // KEY TEST: Regular chat marker should NOT appear
        await expect(page.getByText(regularChatMarker)).toHaveCount(0);

        // Send message to assistant
        const assistantTextbox = page.getByRole("textbox", {
          name: /type a message/i,
        });
        await assistantTextbox.fill(`${assistantChatMarker} - say hello`);
        await assistantTextbox.press("Enter");
        await chatIsReadyToChat(page, { expectAssistantResponse: true });

        // Verify only assistant marker appears
        await expect(page.getByText(assistantChatMarker)).toBeVisible();
        await expect(page.getByText(regularChatMarker)).toHaveCount(0);
      },
    );

    test(
      "Can navigate from active streaming chat to assistant",
      { tag: TAG_CI },
      async ({ page }) => {
        // User sends message, doesn't wait for response, clicks assistant
        const randomSuffix = Math.floor(Math.random() * 16777215)
          .toString(16)
          .padStart(6, "0");
        const assistantName = `StreamInterrupt-${randomSuffix}`;

        await createTestAssistant(page, assistantName);

        // Start regular chat
        await page.goto("/chat/new");
        await chatIsReadyToChat(page);

        const textbox = page.getByRole("textbox", { name: /type a message/i });
        await textbox.fill("Write a long story about dragons");
        await textbox.press("Enter");

        // Wait for user message to appear (optimistic update)
        await expect(page.getByTestId("message-user")).toBeVisible();

        // DON'T wait for assistant response - navigate away immediately
        await page.goto("/assistants");
        await page.waitForTimeout(300);

        const assistantButton = page.getByRole("button", {
          name: new RegExp(assistantName),
        });
        await assistantButton.click();

        // Wait for assistant chat
        await expect(
          page.getByRole("textbox", { name: /type a message/i }),
        ).toBeVisible();

        // KEY TESTS:
        // 1. No content about dragons should appear
        await expect(page.getByText("dragons")).toHaveCount(0);

        // 2. Input should be immediately usable
        const assistantTextbox = page.getByRole("textbox", {
          name: /type a message/i,
        });
        await expect(assistantTextbox).toBeEnabled();

        // 3. Should be able to have a conversation with assistant
        await assistantTextbox.fill("Hello!");
        await assistantTextbox.press("Enter");
        await chatIsReadyToChat(page, { expectAssistantResponse: true });
        await expect(page.getByTestId("message-assistant")).toBeVisible();
      },
    );
  });

  test.describe("From Assistant to Regular Chat", () => {
    test(
      "Can create new regular chat after using assistant",
      { tag: TAG_CI },
      async ({ page }) => {
        const randomSuffix = Math.floor(Math.random() * 16777215)
          .toString(16)
          .padStart(6, "0");
        const assistantName = `ToRegular-${randomSuffix}`;
        const assistantMarker = `ASST_MSG_${randomSuffix}`;
        const regularMarker = `REG_MSG_${randomSuffix}`;

        await createTestAssistant(page, assistantName);

        // Start assistant chat
        await page.goto("/assistants");
        await page.waitForTimeout(500);

        const assistantButton = page.getByRole("button", {
          name: new RegExp(assistantName),
        });
        await assistantButton.click();
        await chatIsReadyToChat(page);

        // Send message to assistant
        const assistantTextbox = page.getByRole("textbox", {
          name: /type a message/i,
        });
        await assistantTextbox.fill(`${assistantMarker} - greet me`);
        await assistantTextbox.press("Enter");
        await chatIsReadyToChat(page, { expectAssistantResponse: true });

        // Verify assistant chat has the message
        await expect(page.getByText(assistantMarker)).toBeVisible();

        // Navigate to new regular chat
        await page.goto("/chat/new");
        await chatIsReadyToChat(page);

        // KEY TESTS:
        // 1. Assistant message should NOT appear
        await expect(page.getByText(assistantMarker)).toHaveCount(0);
        await expect(page.getByTestId("message-user")).toHaveCount(0);

        // 2. Should be able to use regular chat
        const regularTextbox = page.getByRole("textbox", {
          name: /type a message/i,
        });
        await expect(regularTextbox).toBeEnabled();

        await regularTextbox.fill(`${regularMarker} - hello`);
        await regularTextbox.press("Enter");
        await chatIsReadyToChat(page, { expectAssistantResponse: true });

        // Verify regular chat works and has only its content
        await expect(page.getByText(regularMarker)).toBeVisible();
        await expect(page.getByText(assistantMarker)).toHaveCount(0);
      },
    );
  });

  test.describe("Between Different Assistants", () => {
    test(
      "Switching between assistants maintains separate state",
      { tag: TAG_CI },
      async ({ page }) => {
        const randomSuffix1 = Math.floor(Math.random() * 16777215)
          .toString(16)
          .padStart(6, "0");
        const randomSuffix2 = Math.floor(Math.random() * 16777215)
          .toString(16)
          .padStart(6, "0");

        const assistant1Name = `First-${randomSuffix1}`;
        const assistant2Name = `Second-${randomSuffix2}`;
        const marker1 = `ASST1_${randomSuffix1}`;
        const marker2 = `ASST2_${randomSuffix2}`;

        // Create two assistants
        await createTestAssistant(page, assistant1Name);
        await createTestAssistant(page, assistant2Name);

        // Use first assistant
        await page.goto("/assistants");
        await page.waitForTimeout(500);

        const assistant1Button = page.getByRole("button", {
          name: new RegExp(assistant1Name),
        });
        await assistant1Button.click();
        await chatIsReadyToChat(page);

        const textbox1 = page.getByRole("textbox", { name: /type a message/i });
        await textbox1.fill(`${marker1} - first assistant message`);
        await textbox1.press("Enter");
        await chatIsReadyToChat(page, { expectAssistantResponse: true });

        // Verify first assistant has the message
        await expect(page.getByText(marker1)).toBeVisible();

        // Switch to second assistant
        await page.goto("/assistants");
        await page.waitForTimeout(500);

        const assistant2Button = page.getByRole("button", {
          name: new RegExp(assistant2Name),
        });
        await assistant2Button.click();
        await chatIsReadyToChat(page);

        // KEY TEST: First assistant's message should NOT appear
        await expect(page.getByText(marker1)).toHaveCount(0);
        await expect(page.getByTestId("message-user")).toHaveCount(0);

        // Use second assistant
        const textbox2 = page.getByRole("textbox", { name: /type a message/i });
        await expect(textbox2).toBeEnabled();

        await textbox2.fill(`${marker2} - second assistant message`);
        await textbox2.press("Enter");
        await chatIsReadyToChat(page, { expectAssistantResponse: true });

        // Verify second assistant has only its message
        await expect(page.getByText(marker2)).toBeVisible();
        await expect(page.getByText(marker1)).toHaveCount(0);
      },
    );
  });

  test.describe("Rapid Assistant Navigation", () => {
    test(
      "Can rapidly switch between assistant and regular chat",
      { tag: TAG_CI },
      async ({ page }) => {
        const randomSuffix = Math.floor(Math.random() * 16777215)
          .toString(16)
          .padStart(6, "0");
        const assistantName = `RapidNav-${randomSuffix}`;

        await createTestAssistant(page, assistantName);

        // Create regular chat
        await page.goto("/chat/new");
        await chatIsReadyToChat(page);
        const regularTextbox = page.getByRole("textbox", {
          name: /type a message/i,
        });
        await regularTextbox.fill("Regular chat content");
        await regularTextbox.press("Enter");
        await chatIsReadyToChat(page, { expectAssistantResponse: true });
        const regularChatUrl = page.url();

        // Rapid navigation cycles
        for (let i = 0; i < 3; i++) {
          // Go to assistant
          await page.goto("/assistants");
          await page.waitForTimeout(300);
          const assistantButton = page.getByRole("button", {
            name: new RegExp(assistantName),
          });
          await assistantButton.click();
          await chatIsReadyToChat(page);

          // Should not see regular chat content
          await expect(page.getByText("Regular chat content")).toHaveCount(0);
          // Should have working input
          await expect(
            page.getByRole("textbox", { name: /type a message/i }),
          ).toBeEnabled();

          // Go back to regular chat
          await page.goto(regularChatUrl);
          await chatIsReadyToChat(page);

          // Should see regular chat content
          await expect(page.getByText("Regular chat content")).toBeVisible();

          // Go to new chat
          await page.goto("/chat/new");
          await chatIsReadyToChat(page);

          // Should be empty
          await expect(page.getByTestId("message-user")).toHaveCount(0);
          await expect(
            page.getByRole("textbox", { name: /type a message/i }),
          ).toBeEnabled();
        }
      },
    );
  });

  test.describe("Assistant Chat Continuity", () => {
    test(
      "Can return to assistant chat and continue conversation",
      { tag: TAG_CI },
      async ({ page }) => {
        const randomSuffix = Math.floor(Math.random() * 16777215)
          .toString(16)
          .padStart(6, "0");
        const assistantName = `Continue-${randomSuffix}`;

        await createTestAssistant(page, assistantName);

        // Start assistant chat
        await page.goto("/assistants");
        await page.waitForTimeout(500);

        const assistantButton = page.getByRole("button", {
          name: new RegExp(assistantName),
        });
        await assistantButton.click();
        await chatIsReadyToChat(page);

        // Send first message
        const textbox = page.getByRole("textbox", { name: /type a message/i });
        await textbox.fill("First message to assistant");
        await textbox.press("Enter");
        await chatIsReadyToChat(page, { expectAssistantResponse: true });

        // Save the URL for this assistant chat
        const assistantChatUrl = page.url();

        // Navigate away
        await page.goto("/chat/new");
        await chatIsReadyToChat(page);
        await expect(page.getByTestId("message-user")).toHaveCount(0);

        // Return to assistant chat
        await page.goto(assistantChatUrl);
        await chatIsReadyToChat(page);

        // First message should still be there
        await expect(
          page.getByText("First message to assistant"),
        ).toBeVisible();

        // Should be able to continue the conversation
        const continuedTextbox = page.getByRole("textbox", {
          name: /type a message/i,
        });
        await expect(continuedTextbox).toBeEnabled();

        await continuedTextbox.fill("Second message to continue");
        await continuedTextbox.press("Enter");
        await chatIsReadyToChat(page, { expectAssistantResponse: true });

        // Both messages should be visible
        await expect(page.getByText("First message")).toBeVisible();
        await expect(page.getByText("Second message")).toBeVisible();
        await expect(page.getByTestId("message-user")).toHaveCount(2);
      },
    );
  });
});
