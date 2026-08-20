import { t } from "@lingui/core/macro";
import * as reactQuery from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";

import { Chat } from "@/components/ui/Chat/Chat";
import { ChatEmptyState } from "@/components/ui/Chat/ChatEmptyState";
import { Alert } from "@/components/ui/Feedback/Alert";
import { seedGenerationStatusFromListing } from "@/hooks/chat/store/generationStatusStore";
import { useDelegatedRunHeader } from "@/hooks/chat/useDelegatedRunHeader";
import {
  useAvailableModels,
  useGetAssistant,
  useRecentChats,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useChatContext } from "@/providers/ChatProvider";
import {
  useAssistantsFeature,
  usePinnedChatsFeature,
} from "@/providers/FeatureConfigProvider";
import { extractTextFromContent } from "@/utils/adapters/contentPartAdapter";
import {
  isDelegatedRun,
  mapRecentChatToSession,
} from "@/utils/chat/recentChatSession";
import { createLogger } from "@/utils/debugLogger";
import { transformEmailFencesForCopy } from "@/utils/emailClipboard";

import type {
  AssistantFile,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "@/types/chat";
import type { MessageAction } from "@/types/message-controls";

const logger = createLogger("UI", "AssistantChatSpacePage");

/**
 * The window this page narrows to one assistant client-side; `recent_chats`
 * cannot filter by assistant, so an assistant whose chats fall outside it
 * shows fewer rows.
 */
const ASSISTANT_CHATS_PAGE_SIZE = 50;

const byMostRecent = (a: ChatSession, b: ChatSession) =>
  new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

const getPreviewUrl = (
  file: Pick<AssistantFile, "preview_url">,
): string | undefined =>
  typeof file.preview_url === "string" ? file.preview_url : undefined;

const toFileUploadItems = (files: AssistantFile[]): FileUploadItem[] =>
  files.flatMap((file) => {
    const downloadUrl = file.download_url;
    const previewUrl = getPreviewUrl(file);

    return downloadUrl || previewUrl
      ? [
          {
            id: file.id,
            filename: file.filename,
            // Preserve preview-only assistant files so erato-file:// links can
            // still resolve inside chat, while hiding the download action when
            // no dedicated download URL is available.
            download_url: downloadUrl ?? "",
            ...(previewUrl ? { preview_url: previewUrl } : {}),
            file_capability: file.file_capability,
            is_sharepoint_file: file.is_sharepoint_file,
          } as FileUploadItem,
        ]
      : [];
  });

export default function AssistantChatSpacePage() {
  const { assistantId, chatId } = useParams<{
    assistantId: string;
    chatId?: string;
  }>();
  const shouldFetchAssistant = !chatId;

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

  const { delegationEnabled } = useAssistantsFeature();

  // Own list request rather than the sidebar's: this space also shows the
  // delegated runs every listing hides, and the sidebar's own filters must not
  // reach in here.
  const { data: recentChats, isLoading: isLoadingChats } = useRecentChats(
    assistantId
      ? {
          queryParams: {
            limit: ASSISTANT_CHATS_PAGE_SIZE,
            type: "assistant",
            include_delegated: true,
          },
        }
      : reactQuery.skipToken,
  );

  // Get chat context
  const {
    messages: contextMessages,
    messageOrder: contextMessageOrder,
    currentChatId,
    mountKey,
    pinChat,
    pinnedChats,
  } = useChatContext();
  const { enabled: pinnedChatsEnabled, maxItems: pinnedChatsLimit } =
    usePinnedChatsFeature();

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

  const chatsOfAssistant = useMemo(
    () =>
      recentChats?.chats.filter((chat) => chat.assistant_id === assistantId) ??
      [],
    [recentChats?.chats, assistantId],
  );

  const [assistantChats, delegatedRuns] = useMemo(() => {
    const own: ChatSession[] = [];
    const delegated: ChatSession[] = [];
    for (const chat of chatsOfAssistant) {
      (isDelegatedRun(chat) ? delegated : own).push(
        mapRecentChatToSession(chat),
      );
    }
    return [own.sort(byMostRecent), delegated.sort(byMostRecent)];
  }, [chatsOfAssistant]);

  // Delegated runs are hidden from every listing, so nothing else seeds their
  // running or parked markers into the status store.
  useEffect(() => {
    seedGenerationStatusFromListing(chatsOfAssistant.filter(isDelegatedRun));
  }, [chatsOfAssistant]);

  // Handle message actions
  const handleMessageAction = async (action: MessageAction) => {
    logger.log("Handling message action in AssistantChatSpacePage:", action);

    if (action.type === "copy") {
      const messageToCopy = contextMessages[action.messageId];
      const textContent = transformEmailFencesForCopy(
        extractTextFromContent(messageToCopy.content),
      );
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

  // This is the route a delegated run opens on: the trace's "open run" link
  // and the assistant space's delegated-runs segment both land here.
  const { header: delegatedRunHeader, composerLocked } =
    useDelegatedRunHeader(effectiveChatId);

  // Loading state
  if (shouldFetchAssistant && isLoadingAssistant) {
    return (
      <div className="flex size-full flex-col">
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
            <p className="text-sm text-theme-fg-secondary">
              {t({
                id: "assistant.loading",
                message: "Loading assistant...",
              })}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (shouldFetchAssistant && (assistantError || !assistant)) {
    return (
      <div className="flex size-full flex-col">
        <div className="flex flex-1 items-center justify-center p-6">
          <Alert type="error">
            {t({
              id: "assistant.error.load",
              message: "Failed to load assistant. Please try again.",
            })}
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
        topContent={delegatedRunHeader}
        composerDisabled={composerLocked}
        emptyStateComponent={
          assistant ? (
            <ChatEmptyState
              variant="assistant"
              assistant={assistant}
              pastChats={assistantChats}
              delegatedRuns={delegatedRuns}
              delegationEnabled={delegationEnabled}
              isLoadingChats={isLoadingChats}
              onChatPin={
                pinnedChatsEnabled
                  ? (chatId, isPinned) => {
                      void pinChat(chatId, isPinned);
                    }
                  : undefined
              }
              pinnedChatsCount={pinnedChats.length}
              pinnedChatsLimit={pinnedChatsLimit}
            />
          ) : (
            <ChatEmptyState variant="chat" />
          )
        }
        onMessageAction={handleMessageAction}
        // Only pass assistantId when creating a NEW chat (no chatId in URL)
        // For existing chats, the assistant context is already stored in the chat
        assistantId={chatId ? undefined : assistantId}
        initialModelOverride={assistantDefaultModel}
        assistantFiles={toFileUploadItems(assistant?.files ?? [])}
        assistantConfiguredFacetIds={assistant?.facet_ids ?? []}
        assistantFacetSettingsEnforced={
          assistant?.enforce_facet_settings ?? false
        }
      />
    </div>
  );
}
