import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { chatIsReadyToChat, ensureOpenSidebar } from "./shared";

/**
 * Navigation State Cleanup Tests
 *
 * These tests validate that state is properly cleaned up when navigating between
 * chats. The key insight from assistant-chat-entry-points-analysis.md is that
 * certain entry points were missing cleanup calls:
 *
 * Required cleanup (cleanupForNewConversation):
 * 1. abortActiveSSE() - Abort any active SSE stream
 * 2. clearUserMessages() - Clear optimistic user messages from the store
 * 3. resetStreaming() - Reset streaming state (isStreaming, content, etc.)
 *
 * IMPORTANT: These tests verify OBSERVABLE BEHAVIOR, not implementation details.
 * Without proper cleanup, users would experience:
 * - Input field locked/disabled (isStreaming still true)
 * - Old messages appearing in new chat
 * - Unable to send messages in new chat
 *
 * We avoid mocking/suppressing - we test real user flows.
 */

test.describe("Navigation State Cleanup - Core Behavior", () => {
  test(
    "Can immediately type and send message after navigating to new chat",
    { tag: TAG_CI },
    async ({ page }) => {
      // This is the most fundamental test - if cleanup works, this must work
      await page.goto("/");
      await chatIsReadyToChat(page);
      await ensureOpenSidebar(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // Send a message and wait for response
      await textbox.fill("First chat: tell me about the moon");
      await textbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });

      // Now navigate to new chat
      await page.goto("/chat/new");
      await chatIsReadyToChat(page);

      // KEY TEST: Input should be immediately usable
      const newTextbox = page.getByRole("textbox", {
        name: "Type a message...",
      });
      await expect(newTextbox).toBeVisible();
      await expect(newTextbox).toBeEnabled();
      await expect(newTextbox).toHaveValue("");

      // We should be able to send a message and get a response
      await newTextbox.fill("Second chat: tell me about the sun");
      await newTextbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });

      // Verify we got a response (proving the new chat works)
      await expect(page.getByTestId("message-assistant")).toBeVisible();
    },
  );

  test(
    "Messages from previous chat do not appear in new chat",
    { tag: TAG_CI },
    async ({ page }) => {
      // Use unique identifiable content
      const firstChatMarker = `FIRST_CHAT_${Date.now()}`;
      const secondChatMarker = `SECOND_CHAT_${Date.now()}`;

      await page.goto("/");
      await chatIsReadyToChat(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // Create first chat with identifiable content
      await textbox.fill(`${firstChatMarker} - write a haiku`);
      await textbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });

      // Verify first chat marker is visible
      await expect(page.getByText(firstChatMarker)).toBeVisible();

      // Navigate to new chat
      await page.goto("/chat/new");
      await chatIsReadyToChat(page);

      // KEY TEST: First chat marker should NOT appear
      await expect(page.getByText(firstChatMarker)).toHaveCount(0);

      // Send message in second chat
      const newTextbox = page.getByRole("textbox", {
        name: "Type a message...",
      });
      await newTextbox.fill(`${secondChatMarker} - write a limerick`);
      await newTextbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });

      // Verify only second chat marker appears
      await expect(page.getByText(secondChatMarker)).toBeVisible();
      await expect(page.getByText(firstChatMarker)).toHaveCount(0);
    },
  );

  test(
    "Each chat maintains its own message history",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await chatIsReadyToChat(page);
      await ensureOpenSidebar(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // Create first chat
      await textbox.fill("Chat 1: What is 2+2?");
      await textbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });
      const firstChatUrl = page.url();

      // Create second chat
      await page.goto("/chat/new");
      await chatIsReadyToChat(page);

      const newTextbox = page.getByRole("textbox", {
        name: "Type a message...",
      });
      await newTextbox.fill("Chat 2: What is 3+3?");
      await newTextbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });
      const secondChatUrl = page.url();

      // Verify second chat has correct content
      await expect(page.getByText("Chat 2")).toBeVisible();
      await expect(page.getByText("Chat 1")).toHaveCount(0);

      // Navigate back to first chat
      await page.goto(firstChatUrl);
      await chatIsReadyToChat(page);

      // Verify first chat has correct content
      await expect(page.getByText("Chat 1")).toBeVisible();
      await expect(page.getByText("Chat 2")).toHaveCount(0);

      // Navigate to second chat again
      await page.goto(secondChatUrl);
      await chatIsReadyToChat(page);

      // Verify second chat still has correct content
      await expect(page.getByText("Chat 2")).toBeVisible();
      await expect(page.getByText("Chat 1")).toHaveCount(0);
    },
  );
});

test.describe("Navigation During Active Chat", () => {
  test(
    "Can navigate away and start new chat while response is still generating",
    { tag: TAG_CI },
    async ({ page }) => {
      // This tests that we can interrupt a streaming response and start fresh
      await page.goto("/");
      await chatIsReadyToChat(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // Send a message that will generate a longer response
      await textbox.fill(
        "Write a detailed paragraph about artificial intelligence",
      );
      await textbox.press("Enter");

      // Don't wait for completion - navigate away after user message appears
      await expect(page.getByTestId("message-user")).toBeVisible();

      // Navigate to new chat
      await page.goto("/chat/new");
      await chatIsReadyToChat(page);

      // KEY TEST: Should be able to immediately use the new chat
      const newTextbox = page.getByRole("textbox", {
        name: "Type a message...",
      });
      await expect(newTextbox).toBeEnabled();

      // Send a new message
      await newTextbox.fill("Say hello");
      await newTextbox.press("Enter");

      // Should get a response in the new chat
      await chatIsReadyToChat(page, { expectAssistantResponse: true });
      await expect(page.getByTestId("message-assistant")).toBeVisible();

      // Verify no content about "artificial intelligence" appears
      // (from the abandoned first chat)
      const userMessages = page.locator('[data-testid="message-user"]');
      await expect(userMessages).toHaveCount(1);
      await expect(userMessages.first()).toContainText("Say hello");
    },
  );

  test(
    "Input is not locked after navigating away from streaming chat",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await chatIsReadyToChat(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // Start a chat
      await textbox.fill("Tell me a story");
      await textbox.press("Enter");

      // Wait for user message to appear (optimistic update)
      await expect(page.getByTestId("message-user")).toBeVisible();

      // Navigate away without waiting for response
      await page.goto("/chat/new");
      await chatIsReadyToChat(page);

      // KEY TEST: Input must be enabled and functional
      const newTextbox = page.getByRole("textbox", {
        name: "Type a message...",
      });

      // Should be enabled (not disabled by stale streaming state)
      await expect(newTextbox).toBeEnabled();

      // Should be empty (not containing stale content)
      await expect(newTextbox).toHaveValue("");

      // Should accept input
      await newTextbox.fill("New message");
      await expect(newTextbox).toHaveValue("New message");

      // Should be able to submit
      await newTextbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });
    },
  );
});

test.describe("Rapid Navigation Stress Tests", () => {
  test(
    "Multiple rapid navigations between chats work correctly",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await chatIsReadyToChat(page);
      await ensureOpenSidebar(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // Create first chat
      await textbox.fill("First chat message");
      await textbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });
      const firstChatUrl = page.url();

      // Create second chat
      await page.goto("/chat/new");
      await chatIsReadyToChat(page);
      const newTextbox = page.getByRole("textbox", {
        name: "Type a message...",
      });
      await newTextbox.fill("Second chat message");
      await newTextbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });
      const secondChatUrl = page.url();

      // Rapid navigation: 5 cycles between chats and new chat
      for (let i = 0; i < 5; i++) {
        // Go to first chat
        await page.goto(firstChatUrl);
        await chatIsReadyToChat(page);
        await expect(page.getByText("First chat")).toBeVisible();

        // Go to new chat
        await page.goto("/chat/new");
        await chatIsReadyToChat(page);
        await expect(page.getByTestId("message-user")).toHaveCount(0);

        // Go to second chat
        await page.goto(secondChatUrl);
        await chatIsReadyToChat(page);
        await expect(page.getByText("Second chat")).toBeVisible();
      }

      // Final verification: all chats still work
      await page.goto(firstChatUrl);
      await chatIsReadyToChat(page);
      await expect(page.getByText("First chat")).toBeVisible();

      await page.goto("/chat/new");
      await chatIsReadyToChat(page);
      const finalTextbox = page.getByRole("textbox", {
        name: "Type a message...",
      });
      await expect(finalTextbox).toBeEnabled();
      await expect(page.getByTestId("message-user")).toHaveCount(0);
    },
  );

  test(
    "Can create multiple new chats in succession",
    { tag: TAG_CI },
    async ({ page }) => {
      // Create 3 chats in quick succession
      const chatUrls: string[] = [];

      for (let i = 1; i <= 3; i++) {
        await page.goto("/chat/new");
        await chatIsReadyToChat(page);

        const textbox = page.getByRole("textbox", {
          name: "Type a message...",
        });
        await expect(textbox).toBeEnabled();

        await textbox.fill(`Chat number ${i}`);
        await textbox.press("Enter");
        await chatIsReadyToChat(page, { expectAssistantResponse: true });

        chatUrls.push(page.url());
      }

      // Verify each chat has its own content
      for (let i = 0; i < 3; i++) {
        await page.goto(chatUrls[i]);
        await chatIsReadyToChat(page);
        await expect(page.getByText(`Chat number ${i + 1}`)).toBeVisible();

        // Verify other chat content doesn't appear
        for (let j = 0; j < 3; j++) {
          if (j !== i) {
            await expect(page.getByText(`Chat number ${j + 1}`)).toHaveCount(0);
          }
        }
      }
    },
  );
});

test.describe("Sidebar Navigation", () => {
  test(
    "Clicking chat in sidebar shows correct content",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await chatIsReadyToChat(page);
      await ensureOpenSidebar(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // Create a chat
      await textbox.fill("Sidebar test message");
      await textbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });
      const chatId = page.url().split("/").pop();

      // Navigate to new chat
      await page.goto("/chat/new");
      await chatIsReadyToChat(page);

      // Verify new chat is empty
      await expect(page.getByTestId("message-user")).toHaveCount(0);

      // Click on the chat in sidebar
      const sidebar = page.getByRole("complementary");
      const chatLink = sidebar.locator(`[data-chat-id="${chatId}"]`);
      await expect(chatLink).toBeVisible();
      await chatLink.click();

      // Wait for navigation and verify content
      await chatIsReadyToChat(page);
      await expect(page.getByText("Sidebar test message")).toBeVisible();
    },
  );

  test(
    "Message count stays consistent when navigating via sidebar",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await chatIsReadyToChat(page);
      await ensureOpenSidebar(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // Create a chat with a message
      await textbox.fill("Single message chat");
      await textbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });
      const chatUrl = page.url();
      const chatId = chatUrl.split("/").pop();

      // Should have exactly 1 user message and 1 assistant message
      await expect(page.getByTestId("message-user")).toHaveCount(1);
      await expect(page.getByTestId("message-assistant")).toHaveCount(1);

      // Navigate away and back via sidebar multiple times
      for (let i = 0; i < 3; i++) {
        await page.goto("/chat/new");
        await chatIsReadyToChat(page);
        await expect(page.getByTestId("message-user")).toHaveCount(0);

        const sidebar = page.getByRole("complementary");
        await sidebar.locator(`[data-chat-id="${chatId}"]`).click();
        await chatIsReadyToChat(page);

        // KEY TEST: Message count should stay the same (no duplicates)
        await expect(page.getByTestId("message-user")).toHaveCount(1);
        await expect(page.getByTestId("message-assistant")).toHaveCount(1);
      }
    },
  );
});

test.describe("Browser Refresh Behavior", () => {
  test(
    "Chat content persists after page refresh",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await chatIsReadyToChat(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // Create a chat
      await textbox.fill("Message before refresh");
      await textbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });

      // Verify content exists
      await expect(page.getByText("Message before refresh")).toBeVisible();

      // Refresh the page
      await page.reload();
      await chatIsReadyToChat(page);

      // Content should still be there
      await expect(page.getByText("Message before refresh")).toBeVisible();
    },
  );

  test(
    "New chat page is empty after refresh",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/chat/new");
      await chatIsReadyToChat(page);

      // New chat should be empty
      await expect(page.getByTestId("message-user")).toHaveCount(0);

      // Refresh
      await page.reload();
      await chatIsReadyToChat(page);

      // Should still be empty
      await expect(page.getByTestId("message-user")).toHaveCount(0);

      // Input should be functional
      const textbox = page.getByRole("textbox", {
        name: "Type a message...",
      });
      await expect(textbox).toBeEnabled();
    },
  );
});

test.describe("Assistant Page Navigation", () => {
  test(
    "Navigating to assistants page and back to new chat works",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await chatIsReadyToChat(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // Create a chat
      await textbox.fill("Regular chat before assistants");
      await textbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });

      // Navigate to assistants page
      await page.goto("/assistants");
      await page.waitForTimeout(500); // Wait for page to stabilize

      // Navigate to new chat
      await page.goto("/chat/new");
      await chatIsReadyToChat(page);

      // Should be clean
      await expect(page.getByTestId("message-user")).toHaveCount(0);
      await expect(
        page.getByText("Regular chat before assistants"),
      ).toHaveCount(0);

      // Should be able to send a message
      const newTextbox = page.getByRole("textbox", {
        name: "Type a message...",
      });
      await expect(newTextbox).toBeEnabled();
      await newTextbox.fill("New chat after assistants");
      await newTextbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });
    },
  );
});
