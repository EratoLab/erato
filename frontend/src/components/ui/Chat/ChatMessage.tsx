import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import clsx from "clsx";
import { memo, useCallback, useState } from "react";

import { InteractiveContainer } from "@/components/ui/Container/InteractiveContainer";
import { FilePreviewButton } from "@/components/ui/FileUpload/FilePreviewButton";
import { useImageLightbox } from "@/hooks/ui/useImageLightbox";
import { useGetFile } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useMessageFeedbackFeature } from "@/providers/FeatureConfigProvider";
import { hasToolCalls as messageHasToolCalls } from "@/utils/adapters/toolCallAdapter";
import { isImageFile } from "@/utils/file/fileTypeUtils";

import { Alert } from "../Feedback/Alert";
import { Avatar } from "../Feedback/Avatar";
import { LoadingIndicator } from "../Feedback/LoadingIndicator";
import { ActionFacetContext } from "../Message/ActionFacetContext";
import { DefaultMessageControls } from "../Message/DefaultMessageControls";
import { ImageLightbox } from "../Message/ImageLightbox";
import { MessageContent } from "../Message/MessageContent";
import { messageStyles } from "../styles/chatMessageStyles";

import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "../../../types/message-controls";
import type {
  FileUploadItem,
  MessageFeedback,
  UserProfile,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { MessageErrorFilterDetails } from "@/types/chat";
import type { UiChatMessage } from "@/utils/adapters/messageAdapter";

const getPreviewUrl = (
  file: Pick<FileUploadItem, "preview_url" | "download_url">,
): string =>
  typeof file.preview_url === "string" ? file.preview_url : file.download_url;

export interface ChatMessageProps {
  message: UiChatMessage;
  className?: string;
  /**
   * Maximum width of the message container in pixels
   * @default 768 (max-w-3xl)
   */
  maxWidth?: number;
  /**
   * Whether to show the timestamp
   * @default true
   */
  showTimestamp?: boolean;
  /**
   * Whether to show the avatar
   * @default false
   */
  showAvatar?: boolean;
  showControlsOnHover?: boolean;

  // New props
  controls?: MessageControlsComponent;
  controlsContext: MessageControlsContext;
  onMessageAction: (action: MessageAction) => Promise<boolean>;
  userProfile?: UserProfile;
  userDisplayNameOverride?: string;
  onFilePreview?: (file: FileUploadItem) => void;
  onViewFeedback?: (messageId: string, feedback: MessageFeedback) => void;
  /** Map of all files from the entire conversation keyed by file ID */
  allFilesById?: Record<string, FileUploadItem>;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  className = "",
  showTimestamp = true,
  showAvatar = false,
  userProfile,
  showControlsOnHover = true,
  controls: Controls = DefaultMessageControls,
  controlsContext,
  onMessageAction,
  onFilePreview,
  onViewFeedback,
  allFilesById = {},
  userDisplayNameOverride,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const role = isUser ? "user" : "assistant";
  const messageShellStyle = {
    borderRadius: "var(--theme-radius-message)",
    padding:
      "var(--theme-spacing-message-padding-y) var(--theme-spacing-message-padding-x)",
  } as const;
  const messageContentRowStyle = {
    gap: "var(--theme-spacing-message-gap)",
  } as const;

  // Get user display name - use profile name if available, otherwise use form of address
  const userDisplayName = isUser
    ? (userDisplayNameOverride ??
      userProfile?.name ??
      t({ id: "branding.user_form_of_address", message: "You" }))
    : t({ id: "branding.assistant_name", message: "Assistant" });

  // Tool calls live inline in the content array now. The MessageContent
  // renderer surfaces them at their content_index, so the loader does not
  // need to repeat them.
  const hasCompletedToolCalls = messageHasToolCalls(message.content);

  // Get message feedback feature config
  const messageFeedbackConfig = useMessageFeedbackFeature();

  // Local state for raw markdown toggle
  const [showRawMarkdown, setShowRawMarkdown] = useState(false);
  const handleToggleRawMarkdown = useCallback(
    () => setShowRawMarkdown((prev) => !prev),
    [],
  );

  // Use custom hook for image lightbox state management
  const lightbox = useImageLightbox();

  // Use the provided allFilesById from parent
  // This allows erato-file:// links to reference files from any message in the conversation
  const filesById = allFilesById;

  // Content validation
  if (message.content.length === 0 && !message.loading && !message.error) {
    return null;
  }

  return (
    <div
      className={clsx(
        "group relative flex",
        "w-full min-w-[280px] shrink-0",
        messageStyles.hover,
        messageStyles.container[role],
        className,
      )}
      style={messageShellStyle}
      role="log"
      aria-live="polite"
      aria-label={`${userDisplayName} ${t({ id: "chat.message.aria", message: "message" })}`}
      data-testid={`message-${role}`}
      data-message-id={message.id}
      data-ui="chat-message"
      data-role={role}
    >
      <div className="flex w-full" style={messageContentRowStyle}>
        {showAvatar && (
          <Avatar userProfile={userProfile} userOrAssistant={!!isUser} />
        )}

        <div className="min-w-0 flex-1 break-words">
          <div className="flex items-start justify-between">
            <div className="mb-1 text-sm font-semibold text-theme-fg-primary">
              {isUser ? (
                (userDisplayNameOverride ??
                userProfile?.name ?? (
                  <Trans id="branding.user_form_of_address">You</Trans>
                ))
              ) : (
                <Trans id="branding.assistant_name">Assistant</Trans>
              )}
            </div>
          </div>

          {message.error && (
            <Alert
              type="error"
              title={getErrorTitle(message.error.error_type)}
              geometryVariant="message"
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

          {isUser && message.action_facet_args && (
            <ActionFacetContext actionFacetArgs={message.action_facet_args} />
          )}

          <MessageContent
            content={message.content}
            messageId={message.id}
            filesById={filesById}
            isStreaming={!!message.loading && message.loading.state !== "done"}
            showRaw={showRawMarkdown}
            onImageClick={lightbox.openLightbox}
            onFileLinkPreview={onFilePreview}
            preserveSoftLineBreaks={isUser}
            createdAt={message.createdAt}
            updatedAt={message.updatedAt}
            hasError={!!message.error}
          />

          {/* Display attached files if any */}
          {message.input_files_ids && message.input_files_ids.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {message.input_files_ids.map((fileId) => (
                <AttachedFile
                  key={fileId}
                  fileId={fileId}
                  onFilePreview={onFilePreview}
                />
              ))}
            </div>
          )}

          {message.loading && message.content.length === 0 && (
            <div className="mt-2">
              <LoadingIndicator
                state={message.loading.state}
                context={message.loading.context}
              />
            </div>
          )}
          {showTimestamp && (
            <div className="z-10">
              <Controls
                messageId={message.id}
                messageType={message.sender}
                createdAt={message.createdAt}
                context={controlsContext}
                showOnHover={showControlsOnHover}
                onAction={onMessageAction}
                className="z-10"
                isUserMessage={isUser}
                showRawMarkdown={showRawMarkdown}
                onToggleRawMarkdown={handleToggleRawMarkdown}
                hasToolCalls={hasCompletedToolCalls}
                showFeedbackButtons={messageFeedbackConfig.enabled}
                showFeedbackComments={messageFeedbackConfig.commentsEnabled}
                initialFeedback={message.feedback}
                onViewFeedback={onViewFeedback}
              />
            </div>
          )}
        </div>
      </div>

      {/* Image lightbox - rendered via Portal to document.body */}
      <ImageLightbox
        isOpen={lightbox.isOpen}
        onClose={lightbox.closeLightbox}
        image={lightbox.selectedImage}
      />
    </div>
  );
});

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

// Helper component to fetch and display a single attached file
const AttachedFile = ({
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
  } = useGetFile(
    { pathParams: { fileId } },
    {
      // Optional: configure react-query options like staleTime, cacheTime, etc.
      staleTime: Infinity, // Assume file metadata doesn't change often
    },
  );

  if (isLoading) {
    return (
      <div className="text-xs text-theme-fg-muted">
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

  const previewUrl = getPreviewUrl(fileData);

  // Check if it's an image using centralized utility
  if (isImageFile(fileData.filename) && previewUrl) {
    return (
      <div
        className="relative inline-block cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={() => {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (onFilePreview && fileData) {
            onFilePreview(fileData);
          } else if (previewUrl) {
            window.open(previewUrl, "_blank", "noopener,noreferrer");
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (onFilePreview && fileData) {
              onFilePreview(fileData);
            } else if (previewUrl) {
              window.open(previewUrl, "_blank", "noopener,noreferrer");
            }
          }
        }}
      >
        <img
          src={previewUrl}
          alt={fileData.filename}
          className="size-24 rounded-lg border border-theme-border-primary object-cover transition-transform hover:scale-105"
        />
        <div className="mt-1 max-w-[96px] truncate text-xs text-theme-fg-muted">
          {fileData.filename}
        </div>
      </div>
    );
  }

  // For non-images, show the regular file button
  return (
    <InteractiveContainer
      onClick={() => {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (onFilePreview && fileData) {
          onFilePreview(fileData);
        } else if (previewUrl) {
          window.open(previewUrl, "_blank", "noopener,noreferrer"); // eslint-disable-line lingui/no-unlocalized-strings
        }
      }}
      aria-label={`${t({ id: "chat.file.preview.aria", message: "Preview attached file:" })} ${fileData.filename}`}
      className="cursor-pointer hover:bg-theme-bg-accent"
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

// Add display name for better debugging
// eslint-disable-next-line lingui/no-unlocalized-strings
ChatMessage.displayName = "ChatMessage";
