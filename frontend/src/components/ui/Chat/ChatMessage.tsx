import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import clsx from "clsx";
import { memo, useCallback, useMemo, useState } from "react";

import { useImageLightbox } from "@/hooks/ui/useImageLightbox";
import { useMessageFeedbackFeature } from "@/providers/FeatureConfigProvider";
import { hasToolCalls as messageHasToolCalls } from "@/utils/adapters/toolCallAdapter";

import { McpNotices } from "./McpNotices";
import { MessageAttachments } from "./MessageAttachments";
import { MessageErrorAlert } from "./MessageErrorAlert";
import { messageAttachmentFileIds } from "./messageAttachmentFileIds";
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
  MessageControlsProps,
} from "../../../types/message-controls";
import type {
  FileUploadItem,
  MessageFeedback,
  UserProfile,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { UiChatMessage } from "@/utils/adapters/messageAdapter";
import type { ComponentProps } from "react";

/**
 * Host-implemented building blocks handed to `ChatMessageRenderer` overrides.
 * Component kits run in a separately built bundle, so importing these from
 * `@erato/frontend/library` would duplicate module state (React contexts, the
 * lingui i18n instance) — receiving the host's own instances via props is the
 * only identity-safe channel.
 */
export interface ChatMessageHostComponents {
  MessageContent: typeof MessageContent;
  LoadingIndicator: typeof LoadingIndicator;
  McpNotices: typeof McpNotices;
  ActionFacetContext: typeof ActionFacetContext;
}

export const CHAT_MESSAGE_HOST_COMPONENTS: ChatMessageHostComponents = {
  MessageContent,
  LoadingIndicator,
  McpNotices,
  ActionFacetContext,
};

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
  onFilePreview?: (
    file: FileUploadItem,
    relatedFiles?: readonly FileUploadItem[],
  ) => void;
  onViewFeedback?: (messageId: string, feedback: MessageFeedback) => void;
  /** Map of all files from the entire conversation keyed by file ID */
  allFilesById?: Record<string, FileUploadItem>;
  /** Optional so pre-existing renderers and tests remain valid call sites. */
  hostComponents?: ChatMessageHostComponents;
}

export interface ChatMessageRendererState {
  isUser: boolean;
  role: "user" | "assistant";
  /** Who the message is attributed to, already through the host's precedence. */
  userDisplayName: string;
  /** True when the host draws nothing at all for this message. */
  isEmpty: boolean;
  /** Uploads plus, on the assistant side, the documents it generated. */
  attachmentIds: string[];
  /** Every file the conversation knows about, keyed by id. */
  filesById: Record<string, FileUploadItem>;
  /** The same files as a list, for a preview to navigate between. */
  relatedFiles: readonly FileUploadItem[];
  contentProps: ComponentProps<typeof MessageContent>;
  controlsProps: MessageControlsProps;
  lightbox: ReturnType<typeof useImageLightbox>;
}

/**
 * Everything `ChatMessage` works out before it draws anything.
 *
 * `ChatMessage` itself consumes this, so a `ChatMessageRenderer` override that
 * only wants different markup can take the derived values rather than deriving
 * them again — the mention list, the streaming flag, the raw-markdown toggle
 * and the lightbox wiring included. A kit that re-derives them drifts silently:
 * its copy keeps working while its behaviour stops matching the host's.
 */
export const useChatMessageRenderer = ({
  message,
  userProfile,
  showControlsOnHover = true,
  controlsContext,
  onMessageAction,
  onFilePreview,
  onViewFeedback,
  allFilesById = {},
  userDisplayNameOverride,
}: ChatMessageProps): ChatMessageRendererState => {
  const isUser = message.role === "user";
  const role = isUser ? "user" : "assistant";

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
  // Every file the chat knows about, so a viewer can resolve one its own
  // artifact only names — the transcript's uploads are the case in point.
  const relatedFiles = useMemo(
    () => Object.values(allFilesById),
    [allFilesById],
  );

  return {
    isUser,
    role,
    userDisplayName,
    // The host draws nothing for a message with no content, attachments or
    // not; the openwebui kit draws an attachment-only user message instead.
    // The divergence is unresolved, so this reports what the host does.
    isEmpty: message.content.length === 0 && !message.loading && !message.error,
    attachmentIds: messageAttachmentFileIds(message),
    filesById,
    relatedFiles,
    contentProps: {
      content: message.content,
      messageId: message.id,
      filesById,
      isStreaming: !!message.loading && message.loading.state !== "done",
      showRaw: showRawMarkdown,
      onImageClick: lightbox.openLightbox,
      onFileLinkPreview: onFilePreview,
      preserveSoftLineBreaks: isUser,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      hasError: !!message.error,
      hostArtifact: message.hostArtifact ?? message.outlookArtifact,
      // Mentions are a user-message affordance; an assistant echoing
      // "@Name" is quoting, not addressing, so it never highlights.
      mentionedAssistants: isUser ? message.mentioned_assistants : undefined,
    },
    controlsProps: {
      messageId: message.id,
      messageType: message.sender,
      createdAt: message.createdAt,
      context: controlsContext,
      showOnHover: showControlsOnHover,
      onAction: onMessageAction,
      className: "z-10",
      isUserMessage: isUser,
      showRawMarkdown,
      onToggleRawMarkdown: handleToggleRawMarkdown,
      hasToolCalls: hasCompletedToolCalls,
      showFeedbackButtons: messageFeedbackConfig.enabled,
      showFeedbackComments: messageFeedbackConfig.commentsEnabled,
      initialFeedback: message.feedback,
      onViewFeedback,
    },
    lightbox,
  };
};

export const ChatMessage = memo(function ChatMessage(props: ChatMessageProps) {
  const {
    message,
    className = "",
    showTimestamp = true,
    showAvatar = false,
    userProfile,
    controls: Controls = DefaultMessageControls,
    controlsContext,
    onFilePreview,
    userDisplayNameOverride,
  } = props;

  const {
    isUser,
    role,
    userDisplayName,
    isEmpty,
    attachmentIds,
    filesById,
    relatedFiles,
    contentProps,
    controlsProps,
    lightbox,
  } = useChatMessageRenderer(props);

  const messageContentRowStyle = {
    gap: "var(--theme-spacing-message-gap)",
  } as const;

  // Content validation
  if (isEmpty) {
    return null;
  }

  const attachments =
    attachmentIds.length > 0 ? (
      <MessageAttachments
        fileIds={attachmentIds}
        filesById={filesById}
        relatedFiles={relatedFiles}
        onFilePreview={onFilePreview}
      />
    ) : null;

  return (
    <div
      className={clsx(
        "chat-message-skin group relative flex",
        "w-full min-w-[280px] shrink-0",
        // A user message stacks: attachments above, body below. An assistant
        // message has only the body, so the direction is immaterial there and
        // the row default is left alone.
        isUser && "flex-col",
        messageStyles.hover,
        messageStyles.container[role],
        className,
      )}
      role="log"
      aria-live="polite"
      aria-label={`${userDisplayName} ${t({ id: "chat.message.aria", message: "message" })}`}
      data-testid={`message-${role}`}
      data-message-id={message.id}
      data-ui="chat-message"
      data-role={role}
    >
      {/* You attach the files, then you write the prompt — so for a user
          message the attachments sit above the body rather than under it.
          Hoisting them out of the body is also what lets a theme tint the
          body alone: the attachments are a sibling of the tinted surface,
          not a descendant of it. Assistant attachments stay inline below. */}
      {/* `empty:hidden` because the element above is truthy as soon as the
          message names a file, while MessageAttachments renders null until
          those ids resolve — without it a theme styling this hook paints a
          bare box while the fetch is in flight. */}
      {isUser && attachments && (
        <div className="mb-2 empty:hidden" data-ui="message-attachments">
          {attachments}
        </div>
      )}

      <div
        className="flex w-full"
        style={messageContentRowStyle}
        data-ui="message-body"
      >
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

          <MessageErrorAlert message={message} />

          {isUser && message.action_facet_args && (
            <ActionFacetContext actionFacetArgs={message.action_facet_args} />
          )}

          <MessageContent {...contentProps} />

          <McpNotices
            message={message}
            showConnect={!controlsContext.isSharedDialog}
          />

          {/* Display attached files if any — user messages render these
              above the body instead, see the hoisted slot. */}
          {!isUser && attachments}

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
              <Controls {...controlsProps} />
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

// Add display name for better debugging
// eslint-disable-next-line lingui/no-unlocalized-strings
ChatMessage.displayName = "ChatMessage";
