import { Browser, expect, test } from "@playwright/test";
import {
  chatIsReadyToChat,
  createAuthenticatedContext,
  selectModel,
} from "./shared";
import { TAG_CI } from "./tags";

const createDexAuthenticatedContext = async (
  browser: Browser,
  email: string,
) => createAuthenticatedContext(browser, email);

test(
  "Mock-LLM chat succeeds when an authorized MCP server is unavailable",
  { tag: TAG_CI },
  async ({ browser }) => {
    const { context, page } = await createDexAuthenticatedContext(
      browser,
      "mcp-unavailable-resilience@example.com",
    );

    try {
      await page.goto("/");
      await chatIsReadyToChat(page);
      await selectModel(page, "Mock-LLM");

      const textbox = page.getByRole("textbox", { name: "Type a message..." });
      await expect(textbox).toBeVisible();
      await textbox.fill("hello resilient mcp");
      await textbox.press("Enter");

      const latestAssistantMessage = page.getByTestId("message-assistant").last();
      await expect(latestAssistantMessage).toBeVisible();

      await chatIsReadyToChat(page, {
        expectAssistantResponse: true,
        loadingTimeoutMs: 20000,
      });

      await expect(
        latestAssistantMessage.getByTestId("chat-message-error"),
      ).toHaveCount(0);

      const chatId = page.url().split("/").pop();
      expect(chatId).toBeTruthy();

      const messagesResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          response.status() === 200 &&
          response.url().includes(`/api/v1beta/chats/${chatId}/messages`),
      );

      await page.reload();
      await chatIsReadyToChat(page, { expectAssistantResponse: true });

      const messagesResponse = await messagesResponsePromise;
      const body = await messagesResponse.json();
      const assistantMessageWithMetadata = body.messages.find(
        (message: {
          role?: string;
          mcp_servers_unavailable?: string[];
          error?: unknown;
        }) =>
          message.role === "assistant" &&
          Array.isArray(message.mcp_servers_unavailable),
      );

      expect(assistantMessageWithMetadata).toBeTruthy();
      expect(assistantMessageWithMetadata.error).toBeFalsy();
      expect(
        assistantMessageWithMetadata.mcp_servers_unavailable,
      ).toContain("mock_mcp_unavailable_500");
    } finally {
      await context.close();
    }
  },
);
