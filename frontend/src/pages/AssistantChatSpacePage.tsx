import { t } from "@lingui/core/macro";
import * as reactQuery from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";

import { Chat } from "@/components/ui/Chat/Chat";
import { ChatEmptyState } from "@/components/ui/Chat/ChatEmptyState";
import { Alert } from "@/components/ui/Feedback/Alert";
import {
  useAvailableModels,
  useGetAssistant,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useChatContext } from "@/providers/ChatProvider";
import { extractTextFromContent } from "@/utils/adapters/contentPartAdapter";
import { createLogger } from "@/utils/debugLogger";

import type { ChatSession } from "@/types/chat";
import type { MessageAction } from "@/types/message-controls";

const logger = createLogger("UI", "AssistantChatSpacePage");

export default function AssistantChatSpacePage() {
  const { assistantId, chatId } = useParams<{
    assistantId: string;
    chatId?: string;
  }>();

  // Fetch assistant data
  const {
    data: assistant,
    isLoading: isLoadingAssistant,
    error: assistantError,
  } = useGetAssistant(
    assistantId ? { pathParams: { assistantId } } : reactQuery.skipToken,
  );

  // Fetch available models to find the assistant's default model
  const { data: availableModels = [] } = useAvailableModels({});

  // Get chat context
  const {
    messages: contextMessages,
    messageOrder: contextMessageOrder,
    chats: chatHistory,
    currentChatId,
    mountKey,
  } = useChatContext();

  // Use chatId from URL if available, otherwise use currentChatId from context
  const effectiveChatId = chatId ?? currentChatId;

  useEffect(() => {
    if (assistant) {
      document.title = `${assistant.name} - ${t({ id: "branding.page_title_suffix" })}`;
    } else {
      document.title = `${t({ id: "branding.assistant_name", message: "Assistant" })} - ${t({ id: "branding.page_title_suffix" })}`;
    }
  }, [assistant]);

  // Find the assistant's default model from available models
  const assistantDefaultModel = useMemo(() => {
    if (!assistant?.default_chat_provider || availableModels.length === 0) {
      return null;
    }
    return (
      availableModels.find(
        (model) => model.chat_provider_id === assistant.default_chat_provider,
      ) ?? null
    );
  }, [assistant?.default_chat_provider, availableModels]);

  // Filter chats to show only those with this assistant
  const assistantChats = useMemo(() => {
    if (!Array.isArray(chatHistory) || !assistantId) return [];

    // chatHistory here comes from useChatContext, which returns RecentChat[] from the API
    // However, the type in ChatProvider seems to be inferred as RecentChat[] but mapped to ChatSession[] in some places?
    // Let's look at ChatProvider.tsx again.
    // useChatHistory returns 'chats' which is RecentChat[].
    // So we can access assistant_id directly on the raw chat objects if we use them directly.
    // But wait, useChatContext returns 'chats' which is ReturnType<typeof useChatHistory>["chats"].

    return chatHistory
      .filter(
        (chat) => (chat.assistant_id as unknown as string) === assistantId,
      )
      .map(
        (chat): ChatSession => ({
          id: chat.id,
          title: chat.title_by_summary || t`Untitled Chat`,
          updatedAt: chat.last_message_at || new Date().toISOString(),
          messages: [],
          metadata: {
            lastMessage: {
              content: chat.title_by_summary || "",
              timestamp: chat.last_message_at || new Date().toISOString(),
            },
            fileCount: chat.file_uploads.length,
          },
          assistantId: chat.assistant_id as unknown as string,
        }),
      )
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [chatHistory, assistantId]);

  // Handle message actions
  const handleMessageAction = async (action: MessageAction) => {
    logger.log("Handling message action in AssistantChatSpacePage:", action);

    if (action.type === "copy") {
      const messageToCopy = contextMessages[action.messageId];
      const textContent = extractTextFromContent(messageToCopy.content);
      if (textContent) {
        try {
          await navigator.clipboard.writeText(textContent);
          if (typeof navigator.vibrate === "function") {
            navigator.vibrate(50);
          }
          return true;
        } catch (error) {
          console.error("Failed to copy to clipboard:", error);
          return false;
        }
      }
    }

    return false;
  };

  logger.log(
    `AssistantChatSpacePage render. assistantId: ${assistantId ?? "null"}, chatId from URL: ${chatId ?? "null"}, currentChatId: ${currentChatId ?? "null"}, effectiveChatId: ${effectiveChatId ?? "null"}`,
  );

  // Loading state
  if (isLoadingAssistant) {
    return (
      <div className="flex size-full flex-col">
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
            <p className="text-sm text-theme-fg-secondary">{t`Loading assistant...`}</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (assistantError || !assistant) {
    return (
      <div className="flex size-full flex-col">
        <div className="flex flex-1 items-center justify-center p-6">
          <Alert type="error">
            {t`Failed to load assistant. Please try again.`}
          </Alert>
        </div>
      </div>
    );
  }

  // Render chat interface with assistant welcome screen
  return (
    <div className="flex size-full flex-col">
      <Chat
        key={mountKey}
        messages={contextMessages}
        messageOrder={contextMessageOrder}
        controlsContext={{
          currentUserId: "user1",
          dialogOwnerId: "user1",
          isSharedDialog: false,
        }}
        className="h-full"
        showAvatars={true}
        showTimestamps={true}
        layout="default"
        maxWidth={768}
        emptyStateComponent={
          <ChatEmptyState
            variant="assistant"
            assistant={assistant}
            pastChats={assistantChats}
            isLoadingChats={false}
          />
        }
        onMessageAction={handleMessageAction}
        // Only pass assistantId when creating a NEW chat (no chatId in URL)
        // For existing chats, the assistant context is already stored in the chat
        assistantId={chatId ? undefined : assistantId}
        initialModelOverride={assistantDefaultModel}
        assistantFiles={assistant.files}
      />
    </div>
  );
}
