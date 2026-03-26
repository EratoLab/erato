import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";

import { Chat } from "@/components/ui/Chat/Chat";
import { ChatEmptyState } from "@/components/ui/Chat/ChatEmptyState";
import { DefaultMessageControls } from "@/components/ui/Message/DefaultMessageControls";
import { useResolveChatShareLink } from "@/hooks/useChatShareLink";
import { useChatMessages } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { RootProvider } from "@/providers/RootProvider";
import { extractTextFromContent } from "@/utils/adapters/contentPartAdapter";
import { mapApiMessageToUiMessage } from "@/utils/adapters/messageAdapter";

import type {
  MessageAction,
  MessageControlsProps,
} from "@/types/message-controls";

function SharedMessageControls(props: MessageControlsProps) {
  return <DefaultMessageControls {...props} showFeedbackButtons={false} />;
}

export default function SharedChatPage() {
  const { shareId } = useParams<{ shareId: string }>();

  const {
    data: resolvedLink,
    isLoading: isResolving,
    error: resolveError,
  } = useResolveChatShareLink(shareId ?? null);

  const chatId =
    resolvedLink?.resource_type === "chat" ? resolvedLink.resource_id : null;
  const sharedChatTitle = resolvedLink?.title_resolved ?? null;
  const sharedOwnerDisplayName =
    resolvedLink?.owner_display_name ??
    t({
      id: "chat.share.owner.unknown",
      message: "Unknown user",
    });

  const {
    data: messagesResponse,
    isLoading: isLoadingMessages,
    error: messagesError,
  } = useChatMessages(
    chatId
      ? {
          pathParams: { chatId },
          queryParams: { limit: 1000 },
        }
      : skipToken,
  );

  const messages = useMemo(() => {
    const apiMessages = messagesResponse?.messages ?? [];
    return apiMessages.reduce<
      Record<string, ReturnType<typeof mapApiMessageToUiMessage>>
    >((acc, message) => {
      acc[message.id] = mapApiMessageToUiMessage(message);
      return acc;
    }, {});
  }, [messagesResponse]);

  const messageOrder = useMemo(
    () =>
      (messagesResponse?.messages ?? [])
        .slice()
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        )
        .map((message) => message.id),
    [messagesResponse],
  );
  const fallbackSharedChatTitle = useMemo(() => {
    const firstUserMessage = (messagesResponse?.messages ?? []).find(
      (message) => message.role === "user",
    );
    const firstUserMessageText = firstUserMessage
      ? extractTextFromContent(firstUserMessage.content)
      : "";
    const normalizedTitle = firstUserMessageText.trim().replace(/\s+/g, " ");

    if (!normalizedTitle) {
      return null;
    }

    const maxLength = 80;
    return normalizedTitle.length > maxLength
      ? `${normalizedTitle.slice(0, maxLength - 1).trimEnd()}…`
      : normalizedTitle;
  }, [messagesResponse]);

  const effectiveSharedChatTitle = sharedChatTitle ?? fallbackSharedChatTitle;
  const sharedChatHeader = effectiveSharedChatTitle
    ? t`Shared Chat - ${effectiveSharedChatTitle}`
    : t({
        id: "chat.share.page.title",
        message: "Shared Chat",
      });

  useEffect(() => {
    const pageTitleSuffix = t({ id: "branding.page_title_suffix" });
    document.title = `${sharedChatHeader} - ${pageTitleSuffix}`;
  }, [sharedChatHeader]);

  if (isResolving || isLoadingMessages) {
    return (
      <RootProvider>
        <div className="flex size-full min-w-0 flex-col">
          <Chat
            messages={{}}
            messageOrder={[]}
            messageControls={SharedMessageControls}
            forceCenteredEmptyState={true}
            controlsContext={{
              isSharedDialog: true,
              canEdit: false,
            }}
            onMessageAction={async () => false}
            className="size-full w-full"
            showAvatars={true}
            showTimestamps={true}
            emptyStateComponent={
              <div className="mx-auto max-w-xl px-6 text-center text-theme-fg-secondary">
                {t({
                  id: "chat.share.loading",
                  message: "Loading shared chat...",
                })}
              </div>
            }
            readOnly={true}
          />
        </div>
      </RootProvider>
    );
  }

  if (resolveError || messagesError || !chatId) {
    return (
      <RootProvider>
        <div className="flex size-full min-w-0 flex-col">
          <Chat
            messages={{}}
            messageOrder={[]}
            messageControls={SharedMessageControls}
            forceCenteredEmptyState={true}
            controlsContext={{
              isSharedDialog: true,
              canEdit: false,
            }}
            onMessageAction={async () => false}
            className="size-full w-full"
            showAvatars={true}
            showTimestamps={true}
            emptyStateComponent={
              <div className="mx-auto max-w-xl px-6 text-center text-theme-fg-secondary">
                {t({
                  id: "chat.share.unavailable",
                  message: "This shared chat is unavailable.",
                })}
              </div>
            }
            readOnly={true}
          />
        </div>
      </RootProvider>
    );
  }

  return (
    <RootProvider>
      <div className="flex size-full min-w-0 flex-col">
        <Chat
          messages={messages}
          messageOrder={messageOrder}
          messageControls={SharedMessageControls}
          topContent={
            <div className="min-w-0 text-center">
              <h1 className="truncate text-sm font-semibold text-theme-fg-primary sm:text-base">
                {sharedChatHeader}
              </h1>
            </div>
          }
          userMessageDisplayName={sharedOwnerDisplayName}
          controlsContext={{
            isSharedDialog: true,
            canEdit: false,
          }}
          onMessageAction={async (action: MessageAction) => {
            if (action.type !== "copy") {
              return false;
            }

            const message = messages[action.messageId];
            const textContent = extractTextFromContent(message.content);
            if (!textContent) {
              return false;
            }

            await navigator.clipboard.writeText(textContent);
            return true;
          }}
          className="size-full w-full"
          showAvatars={true}
          showTimestamps={true}
          emptyStateComponent={<ChatEmptyState variant="chat" />}
          readOnly={true}
        />
      </div>
    </RootProvider>
  );
}
