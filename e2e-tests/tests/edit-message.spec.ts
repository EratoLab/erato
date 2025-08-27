import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { chatIsReadyToChat, login, ensureOpenSidebar } from "./shared";

test.describe("Edit Message Functionality", () => {
  test(
    "Can edit a specific message and sends correct messageId to backend",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await login(page, "admin@example.com");
      await chatIsReadyToChat(page);
      await ensureOpenSidebar(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // Send first message
      await textbox.fill("First message");
      await textbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });

      // Send second message
      await textbox.fill("Second message");
      await textbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });

      // Send third message
      await textbox.fill("Third message");
      await textbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });

      // Now we should have 6 messages total: 3 user + 3 assistant
      const userMessages = page.locator('[data-testid="message-user"]');
      await expect(userMessages).toHaveCount(3);

      // Get all user messages and their IDs
      const messageElements = await userMessages.all();
      const messageIds: string[] = [];
      const messageContents: string[] = [];

      for (const messageElement of messageElements) {
        const messageId = await messageElement.getAttribute("data-message-id");
        const content = await messageElement.textContent();
        if (messageId && content) {
          messageIds.push(messageId);
          messageContents.push(content.trim());
        }
      }

      expect(messageIds).toHaveLength(3);
      expect(messageContents.some(content => content.includes("First message"))).toBeTruthy();
      expect(messageContents.some(content => content.includes("Second message"))).toBeTruthy();
      expect(messageContents.some(content => content.includes("Third message"))).toBeTruthy();

      // Find the second message (should contain "Second message")
      let secondMessageElement;
      let secondMessageId;
      
      for (let i = 0; i < messageElements.length; i++) {
        const content = await messageElements[i].textContent();
        if (content && content.includes("Second message")) {
          secondMessageElement = messageElements[i];
          secondMessageId = messageIds[i];
          break;
        }
      }

      expect(secondMessageElement).toBeDefined();
      expect(secondMessageId).toBeDefined();

      console.log(`Found second message with ID: ${secondMessageId}`);
      console.log(`All message IDs: ${JSON.stringify(messageIds)}`);

      // Set up network interception to capture the edit request
      let capturedRequestBody: any = null;
      
      await page.route("**/api/v1beta/me/messages/editstream", async (route) => {
        const request = route.request();
        const postData = request.postData();
        
        if (postData) {
          try {
            capturedRequestBody = JSON.parse(postData);
            console.log("Captured edit request body:", capturedRequestBody);
          } catch (e) {
            console.error("Failed to parse request body:", e);
          }
        }
        
        // Continue with the actual request
        await route.continue();
      });

      // Hover over the second message to reveal controls
      await secondMessageElement!.hover();
      
      // Click the edit button for the second message
      const editButton = secondMessageElement!.getByLabel("Edit message");
      await expect(editButton).toBeVisible();
      await editButton.click();

      // Verify we're in edit mode
      const editTextbox = page.getByRole("textbox", { name: "Edit your message..." });
      await expect(editTextbox).toBeVisible();
      await expect(editTextbox).toHaveValue("Second message");

      // Edit the message content
      await editTextbox.clear();
      await editTextbox.fill("Edited second message");

      // Submit the edit
      const saveButton = page.getByRole("button", { name: "Save edit" });
      await expect(saveButton).toBeEnabled();
      await saveButton.click();

      // Wait for the request to be captured
      await page.waitForTimeout(1000);

      // Verify that the correct messageId was sent to the backend
      expect(capturedRequestBody).not.toBeNull();
      expect(capturedRequestBody.message_id).toBe(secondMessageId);
      expect(capturedRequestBody.replace_user_message).toBe("Edited second message");

      console.log("✅ Test passed: Correct messageId sent to backend");
      console.log(`Expected: ${secondMessageId}`);
      console.log(`Actual: ${capturedRequestBody?.message_id}`);

      // Wait for the edit to complete and verify the UI is back to compose mode
      await expect(page.getByRole("textbox", { name: "Type a message..." })).toBeVisible();
      
      // Note: The actual message content update verification would depend on how
      // the backend responds and updates the UI, which might require additional
      // mocking or waiting for the SSE response to complete.
    }
  );

  test(
    "Edit button only appears on user messages",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await login(page, "admin@example.com");
      await chatIsReadyToChat(page);
      await ensureOpenSidebar(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // Send a message to get both user and assistant messages
      await textbox.fill("Test message for edit button visibility");
      await textbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });

      // Check user message has edit button when hovered
      const userMessage = page.locator('[data-testid="message-user"]').first();
      await userMessage.hover();
      const userEditButton = userMessage.getByLabel("Edit message");
      await expect(userEditButton).toBeVisible();

      // Check assistant message does NOT have edit button
      const assistantMessage = page.locator('[data-testid="message-assistant"]').first();
      await assistantMessage.hover();
      const assistantEditButton = assistantMessage.getByLabel("Edit message");
      await expect(assistantEditButton).not.toBeVisible();
    }
  );

  test(
    "Can cancel edit mode",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await login(page, "admin@example.com");
      await chatIsReadyToChat(page);
      await ensureOpenSidebar(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // Send a message
      await textbox.fill("Message to test cancel edit");
      await textbox.press("Enter");
      await chatIsReadyToChat(page, { expectAssistantResponse: true });

      // Start editing
      const userMessage = page.locator('[data-testid="message-user"]').first();
      await userMessage.hover();
      const editButton = userMessage.getByLabel("Edit message");
      await editButton.click();

      // Verify we're in edit mode
      const editTextbox = page.getByRole("textbox", { name: "Edit your message..." });
      await expect(editTextbox).toBeVisible();

      // Click cancel
      const cancelButton = page.getByRole("button", { name: "Cancel" });
      await cancelButton.click();

      // Verify we're back in compose mode
      await expect(page.getByRole("textbox", { name: "Type a message..." })).toBeVisible();
      await expect(editTextbox).not.toBeVisible();
    }
  );
});