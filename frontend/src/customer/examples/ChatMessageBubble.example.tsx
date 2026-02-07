/**
 * ChatMessageBubble - Example Customer Override
 *
 * A hybrid message renderer that combines a chat-bubble style for user
 * messages with a full-width layout for assistant messages.
 *
 * User messages are compact right-aligned bubbles (iMessage style).
 * Assistant messages use a spacious full-width row with an avatar,
 * giving code blocks, tables, and long markdown room to breathe.
 *
 * Features:
 * - Right-aligned user bubbles with primary-color background
 * - Full-width assistant messages with avatar and neutral background
 * - Asymmetric rounded corners on user bubbles for a chat-tail effect
 * - Reuses MessageContent, Controls, LoadingIndicator, ToolCallDisplay
 * - Full streaming, error, tool-call, and file-attachment support
 *
 * To use this:
 * 1. Copy this file to: src/customer/components/ChatMessageBubble.tsx
 * 2. Update src/config/componentRegistry.ts to import and use it
 *
 * @example
 * // In componentRegistry.ts:
 * import { ChatMessageBubble } from "@/customer/components/ChatMessageBubble";
 *
 * export const componentRegistry: ComponentRegistry = {
 *   ChatMessageRenderer: ChatMessageBubble,
 * };
 */

import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import clsx from "clsx";
import { memo, useCallback, useState } from "react";

import { InteractiveContainer } from "@/components/ui/Container/InteractiveContainer";
import { Alert } from "@/components/ui/Feedback/Alert";
import { Avatar } from "@/components/ui/Feedback/Avatar";
import { LoadingIndicator } from "@/components/ui/Feedback/LoadingIndicator";
import { FilePreviewButton } from "@/components/ui/FileUpload/FilePreviewButton";
import { DefaultMessageControls } from "@/components/ui/Message/DefaultMessageControls";
import { ImageLightbox } from "@/components/ui/Message/ImageLightbox";
import { MessageContent } from "@/components/ui/Message/MessageContent";
import { ToolCallDisplay } from "@/components/ui/ToolCall";
import { useMessagingStore } from "@/hooks/chat/store/messagingStore";
import { useImageLightbox } from "@/hooks/ui/useImageLightbox";
import { useGetFile } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useMessageFeedbackFeature } from "@/providers/FeatureConfigProvider";
import { isImageFile } from "@/utils/file/fileTypeUtils";

import type { ChatMessageProps } from "@/components/ui/Chat/ChatMessage";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { MessageErrorFilterDetails } from "@/types/chat";

export const ChatMessageBubble = memo(function ChatMessageBubble({
  message,
  className = "",
  showTimestamp = true,
  showAvatar = false,
  showControlsOnHover = true,
  controls: Controls = DefaultMessageControls,
  controlsContext,
  onMessageAction,
  userProfile,
  onFilePreview,
  onViewFeedback,
  allFileDownloadUrls = {},
}: ChatMessageProps) {
  const isUser = message.role === "user";

  // Get user display name
  const userDisplayName = isUser
    ? (userProfile?.name ??
      t({ id: "branding.user_form_of_address", message: "You" }))
    : t({ id: "branding.assistant_name", message: "Assistant" });

  // Streaming state for tool calls
  const { streaming } = useMessagingStore();
  const hasToolCalls = Object.keys(streaming.toolCalls).length > 0;
  const isStreamingMessage =
    streaming.isStreaming && streaming.currentMessageId === message.id;

  const hasCompletedToolCalls =
    message.toolCalls && message.toolCalls.length > 0;

  // Feedback feature config
  const messageFeedbackConfig = useMessageFeedbackFeature();

  // Raw markdown toggle
  const [showRawMarkdown, setShowRawMarkdown] = useState(false);
  const handleToggleRawMarkdown = useCallback(
    () => setShowRawMarkdown((prev) => !prev),
    [],
  );

  // Image lightbox
  const lightbox = useImageLightbox();

  const fileDownloadUrls = allFileDownloadUrls;

  // Content validation
  if (message.content.length === 0 && !message.loading && !message.error) {
    return null;
  }

  // ── User messages: compact right-aligned bubble ──────────────────────
  if (isUser) {
    return (
      <div
        className={clsx("group flex w-full justify-end", className)}
        role="log"
        aria-live="polite"
        aria-label={`${userDisplayName} ${t({ id: "chat.message.aria", message: "message" })}`}
        data-testid="message-user"
        data-message-id={message.id}
      >
        <div className="flex max-w-[80%] flex-col items-end">
          {/* Sender name */}
          <div className="mb-1 text-right text-xs font-medium text-theme-fg-muted">
            {userProfile?.name ?? (
              <Trans id="branding.user_form_of_address">You</Trans>
            )}
          </div>

          {/* Bubble */}
          <div
            className={clsx(
              "relative rounded-2xl rounded-br-sm px-4 py-3",
              "bg-[var(--theme-avatar-user-bg)] text-white",
              "transition-shadow duration-150 hover:shadow-md",
            )}
            data-testid="chat-message-bubble"
          >
            {message.error && (
              <Alert
                type="error"
                title={getErrorTitle(message.error.error_type)}
                className="mb-3"
                data-testid="chat-message-error"
              >
                <p>{getErrorDescription(message.error.error_type)}</p>
                {getErrorCta(message.error.error_type) && (
                  <p className="mt-2">
                    {getErrorCta(message.error.error_type)}
                  </p>
                )}
                {renderContentFilterDetails(
                  message.error.error_type,
                  message.error.filter_details,
                )}
              </Alert>
            )}

            <MessageContent
              content={message.content}
              fileDownloadUrls={fileDownloadUrls}
              isStreaming={
                !!message.loading && message.loading.state !== "done"
              }
              showRaw={showRawMarkdown}
              onImageClick={lightbox.openLightbox}
            />

            {message.input_files_ids && message.input_files_ids.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {message.input_files_ids.map((fileId) => (
                  <BubbleAttachedFile
                    key={fileId}
                    fileId={fileId}
                    onFilePreview={onFilePreview}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Controls */}
          {showTimestamp && (
            <div className="mt-1 self-end">
              <Controls
                messageId={message.id}
                messageType={message.sender}
                createdAt={message.createdAt}
                context={controlsContext}
                showOnHover={showControlsOnHover}
                onAction={onMessageAction}
                isUserMessage={true}
                showRawMarkdown={showRawMarkdown}
                onToggleRawMarkdown={handleToggleRawMarkdown}
                hasToolCalls={false}
                showFeedbackButtons={messageFeedbackConfig.enabled}
                showFeedbackComments={messageFeedbackConfig.commentsEnabled}
                initialFeedback={message.feedback}
                onViewFeedback={onViewFeedback}
              />
            </div>
          )}
        </div>

        <ImageLightbox
          isOpen={lightbox.isOpen}
          onClose={lightbox.closeLightbox}
          image={lightbox.selectedImage}
        />
      </div>
    );
  }

  // ── Assistant messages: full-width with avatar ─────────────────────
  return (
    <div
      className={clsx(
        "group flex w-full gap-3 rounded-lg p-4",
        "bg-theme-bg-secondary",
        "hover:bg-[var(--theme-messageItem-hover)]",
        className,
      )}
      role="log"
      aria-live="polite"
      aria-label={`${userDisplayName} ${t({ id: "chat.message.aria", message: "message" })}`}
      data-testid="message-assistant"
      data-message-id={message.id}
    >
      {showAvatar && (
        <div className="mt-0.5 shrink-0">
          <Avatar userProfile={userProfile} userOrAssistant={false} size="sm" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="mb-1 text-sm font-semibold text-theme-fg-primary">
          <Trans id="branding.assistant_name">Assistant</Trans>
        </div>

        {message.error && (
          <Alert
            type="error"
            title={getErrorTitle(message.error.error_type)}
            className="mb-3"
            data-testid="chat-message-error"
          >
            <p>{getErrorDescription(message.error.error_type)}</p>
            {getErrorCta(message.error.error_type) && (
              <p className="mt-2">{getErrorCta(message.error.error_type)}</p>
            )}
            {renderContentFilterDetails(
              message.error.error_type,
              message.error.filter_details,
            )}
          </Alert>
        )}

        <MessageContent
          content={message.content}
          fileDownloadUrls={fileDownloadUrls}
          isStreaming={!!message.loading && message.loading.state !== "done"}
          showRaw={showRawMarkdown}
          onImageClick={lightbox.openLightbox}
        />

        {message.input_files_ids && message.input_files_ids.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.input_files_ids.map((fileId) => (
              <BubbleAttachedFile
                key={fileId}
                fileId={fileId}
                onFilePreview={onFilePreview}
              />
            ))}
          </div>
        )}

        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallDisplay
            toolCalls={message.toolCalls}
            defaultExpanded={false}
            allowToggle={true}
          />
        )}

        {message.loading && (
          <div className="mt-2">
            <LoadingIndicator
              state={message.loading.state}
              context={message.loading.context}
              toolCalls={
                isStreamingMessage && hasToolCalls
                  ? streaming.toolCalls
                  : undefined
              }
            />
          </div>
        )}

        {showTimestamp && (
          <div className="mt-1">
            <Controls
              messageId={message.id}
              messageType={message.sender}
              createdAt={message.createdAt}
              context={controlsContext}
              showOnHover={showControlsOnHover}
              onAction={onMessageAction}
              isUserMessage={false}
              showRawMarkdown={showRawMarkdown}
              onToggleRawMarkdown={handleToggleRawMarkdown}
              hasToolCalls={!!hasCompletedToolCalls}
              showFeedbackButtons={messageFeedbackConfig.enabled}
              showFeedbackComments={messageFeedbackConfig.commentsEnabled}
              initialFeedback={message.feedback}
              onViewFeedback={onViewFeedback}
            />
          </div>
        )}
      </div>

      <ImageLightbox
        isOpen={lightbox.isOpen}
        onClose={lightbox.closeLightbox}
        image={lightbox.selectedImage}
      />
    </div>
  );
});

ChatMessageBubble.displayName = "ChatMessageBubble";

// ── Error helpers (same as default ChatMessage) ──────────────────────

const renderContentFilterDetails = (
  errorType: string,
  filterDetails?: MessageErrorFilterDetails | null,
) => {
  if (errorType !== "content_filter" || !filterDetails) {
    return null;
  }

  const filteredCategories = Object.entries(filterDetails)
    .filter(([, details]) => details.filtered)
    .map(([category, details]) => ({
      category,
      severity: details.severity,
    }));

  if (filteredCategories.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 text-xs">
      <div className="font-medium">
        {t({
          id: "chat.message.error.variant.content_filter.filtered_categories",
          message: "Filtered categories",
        })}
      </div>
      <ul className="mt-1 list-disc pl-5">
        {filteredCategories.map(({ category, severity }) => (
          <li key={category}>
            {getContentFilterCategoryLabel(category)} (
            {getContentFilterSeverityLabel(severity)})
          </li>
        ))}
      </ul>
    </div>
  );
};

const getErrorTitle = (errorType: string) => {
  if (errorType === "content_filter") {
    return undefined;
  }

  return t({
    id: "chat.message.error.title",
    message: "Assistant error",
  });
};

const getErrorDescription = (errorType: string) => {
  if (errorType === "content_filter") {
    return t({
      id: "chat.message.error.variant.content_filter",
      message:
        "The response was filtered due to the prompt triggering content management policy.",
    });
  }

  if (errorType === "rate_limit") {
    return t({
      id: "chat.message.error.variant.rate_limit",
      message:
        "Rate limit or quota exceeded. This can also happen if your input is too large.",
    });
  }

  return t({
    id: "chat.message.error.variant.default",
    message: "The assistant was unable to respond.",
  });
};

const getErrorCta = (errorType: string) => {
  if (errorType === "content_filter") {
    return t({
      id: "chat.message.error.variant.content_filter.cta",
      message:
        "Please try again with a different message that avoids the filtered categories.",
    });
  }

  if (errorType === "rate_limit") {
    return t({
      id: "chat.message.error.variant.rate_limit.cta",
      message:
        "Please try again in a minute, and reduce the length or number of attachments.",
    });
  }

  return undefined;
};

const getContentFilterCategoryLabel = (category: string) => {
  switch (category) {
    case "hate":
      return t({
        id: "chat.message.error.variant.content_filter.hate",
        message: "Hate",
      });
    case "self_harm":
      return t({
        id: "chat.message.error.variant.content_filter.self_harm",
        message: "Self harm",
      });
    case "sexual":
      return t({
        id: "chat.message.error.variant.content_filter.sexual",
        message: "Sexual",
      });
    case "violence":
      return t({
        id: "chat.message.error.variant.content_filter.violence",
        message: "Violence",
      });
    default:
      return formatFilterLabel(category);
  }
};

const getContentFilterSeverityLabel = (severity: string) => {
  switch (severity) {
    case "safe":
      return t({
        id: "chat.message.error.variant.content_filter.safe_severity",
        message: "safe",
      });
    case "low":
      return t({
        id: "chat.message.error.variant.content_filter.low_severity",
        message: "low severity",
      });
    case "medium":
      return t({
        id: "chat.message.error.variant.content_filter.medium_severity",
        message: "medium severity",
      });
    case "high":
      return t({
        id: "chat.message.error.variant.content_filter.high_severity",
        message: "high severity",
      });
    default:
      return formatFilterLabel(severity);
  }
};

const formatFilterLabel = (value: string) =>
  value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");

// Helper component to fetch and display a single attached file within a bubble
const BubbleAttachedFile = ({
  fileId,
  onFilePreview,
}: {
  fileId: string;
  onFilePreview?: (file: FileUploadItem) => void;
}) => {
  const {
    data: fileData,
    isLoading,
    error,
  } = useGetFile({ pathParams: { fileId } }, { staleTime: Infinity });

  if (isLoading) {
    return (
      <div className="text-xs opacity-70">
        {t({ id: "chat.file.loading", message: "Loading file..." })}
      </div>
    );
  }

  if (error || !fileData) {
    console.error(`Failed to load file ${fileId}:`, error);
    return (
      <div className="text-xs text-theme-error-fg">
        {t({ id: "chat.file.error", message: "Error loading file" })}
      </div>
    );
  }

  if (isImageFile(fileData.filename) && fileData.download_url) {
    return (
      <div
        className="relative inline-block cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={() => {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (onFilePreview && fileData) {
            onFilePreview(fileData);
          } else if (fileData.download_url) {
            window.open(fileData.download_url, "_blank", "noopener,noreferrer");
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (onFilePreview && fileData) {
              onFilePreview(fileData);
            } else if (fileData.download_url) {
              window.open(
                fileData.download_url,
                "_blank",
                "noopener,noreferrer",
              );
            }
          }
        }}
      >
        <img
          src={fileData.download_url}
          alt={fileData.filename}
          className="size-24 rounded-lg object-cover transition-transform hover:scale-105"
        />
        <div className="mt-1 max-w-[96px] truncate text-xs opacity-70">
          {fileData.filename}
        </div>
      </div>
    );
  }

  return (
    <InteractiveContainer
      onClick={() => {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (onFilePreview && fileData) {
          onFilePreview(fileData);
        } else if (fileData.download_url) {
          window.open(fileData.download_url, "_blank", "noopener,noreferrer");
        }
      }}
      aria-label={`${t({ id: "chat.file.preview.aria", message: "Preview attached file:" })} ${fileData.filename}`}
      className="cursor-pointer"
      useDiv={true}
    >
      <FilePreviewButton
        file={fileData}
        onRemove={() => {}}
        disabled={true}
        showFileType={true}
        showSize={true}
        filenameTruncateLength={25}
      />
    </InteractiveContainer>
  );
};
