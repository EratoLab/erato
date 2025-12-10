import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import clsx from "clsx";
import { memo, useState } from "react";

import { InteractiveContainer } from "@/components/ui/Container/InteractiveContainer";
import { FilePreviewButton } from "@/components/ui/FileUpload/FilePreviewButton";
import { ToolCallDisplay } from "@/components/ui/ToolCall";
import { useMessagingStore } from "@/hooks/chat/store/messagingStore";
import { useImageLightbox } from "@/hooks/ui/useImageLightbox";
import { useGetFile } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { isImageFile } from "@/utils/file/fileTypeUtils";

import { Avatar } from "../Feedback/Avatar";
import { LoadingIndicator } from "../Feedback/LoadingIndicator";
import { DefaultMessageControls } from "../Message/DefaultMessageControls";
import { ImageLightbox } from "../Message/ImageLightbox";
import { MessageContent } from "../Message/MessageContent";
import { messageStyles } from "../styles/chatMessageStyles";

import type {
  MessageControlsComponent,
  MessageControlsContext,
  MessageAction,
} from "../../../types/message-controls";
import type {
  UserProfile,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { UiChatMessage } from "@/utils/adapters/messageAdapter";

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
  onFilePreview?: (file: FileUploadItem) => void;
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
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const role = isUser ? "user" : "assistant";

  // Get user display name - use profile name if available, otherwise use form of address
  const userDisplayName = isUser
    ? (userProfile?.name ??
      t({ id: "branding.user_form_of_address", message: "You" }))
    : t({ id: "branding.assistant_name", message: "Assistant" });

  // Get streaming state to check for tool calls
  const { streaming } = useMessagingStore();
  const hasToolCalls = Object.keys(streaming.toolCalls).length > 0;
  const isStreamingMessage =
    streaming.isStreaming && streaming.currentMessageId === message.id;

  // Check if message has completed tool calls
  const hasCompletedToolCalls =
    message.toolCalls && message.toolCalls.length > 0;

  // Local state for raw markdown toggle
  const [showRawMarkdown, setShowRawMarkdown] = useState(false);

  // Use custom hook for image lightbox state management
  const lightbox = useImageLightbox();

  // Content validation
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if ((!message.content || message.content.length === 0) && !message.loading) {
    return null;
  }

  return (
    <div
      className={clsx(
        "group relative flex gap-4 rounded-lg p-4",
        "w-full min-w-[280px] shrink-0",
        messageStyles.hover,
        messageStyles.container[role],
        className,
      )}
      role="log"
      aria-live="polite"
      aria-label={`${userDisplayName} ${t`message`}`}
      data-testid={`message-${role}`}
      data-message-id={message.id}
    >
      <div className="flex w-full gap-6">
        {showAvatar && (
          <Avatar userProfile={userProfile} userOrAssistant={!!isUser} />
        )}

        <div className="min-w-0 flex-1 break-words">
          <div className="flex items-start justify-between">
            <div className="mb-1 text-sm font-semibold text-theme-fg-primary">
              {isUser ? (
                (userProfile?.name ?? (
                  <Trans id="branding.user_form_of_address">You</Trans>
                ))
              ) : (
                <Trans id="branding.assistant_name">Assistant</Trans>
              )}
            </div>
          </div>

          <MessageContent
            content={message.content}
            isStreaming={!!message.loading && message.loading.state !== "done"}
            showRaw={showRawMarkdown}
            onImageClick={lightbox.openLightbox}
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

          {/* Display completed tool calls - always shown if they exist */}
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
                // Pass tool calls if this is the streaming assistant message
                toolCalls={
                  !isUser && isStreamingMessage && hasToolCalls
                    ? streaming.toolCalls
                    : undefined
                }
              />
            </div>
          )}
          {showTimestamp && (
            <div className="z-10">
              {Controls === DefaultMessageControls ? (
                <DefaultMessageControls
                  messageId={message.id}
                  messageType={message.sender}
                  createdAt={message.createdAt}
                  context={controlsContext}
                  showOnHover={showControlsOnHover}
                  onAction={onMessageAction}
                  isUserMessage={isUser}
                  showRawMarkdown={showRawMarkdown}
                  onToggleRawMarkdown={() =>
                    setShowRawMarkdown(!showRawMarkdown)
                  }
                  hasToolCalls={hasCompletedToolCalls}
                />
              ) : (
                <Controls
                  messageId={message.id}
                  messageType={message.sender}
                  createdAt={message.createdAt}
                  context={controlsContext}
                  showOnHover={showControlsOnHover}
                  onAction={onMessageAction}
                  className="z-10"
                  isUserMessage={isUser}
                />
              )}
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
      <div className="text-xs text-theme-fg-muted">{t`Loading file...`}</div>
    );
  }

  if (error || !fileData) {
    console.error(`Failed to load file ${fileId}:`, error);
    return (
      <div className="text-xs text-theme-error-fg">{t`Error loading file`}</div>
    );
  }

  // Check if it's an image using centralized utility
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
        } else if (fileData.download_url) {
          window.open(fileData.download_url, "_blank", "noopener,noreferrer"); // eslint-disable-line lingui/no-unlocalized-strings
        }
      }}
      aria-label={`${t`Preview attached file:`} ${fileData.filename}`}
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

// Add display name for better debugging
// eslint-disable-next-line lingui/no-unlocalized-strings
ChatMessage.displayName = "ChatMessage";
