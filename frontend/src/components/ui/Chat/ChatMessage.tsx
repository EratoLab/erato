import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import clsx from "clsx";
import { memo, useCallback, useMemo, useState } from "react";

import { useImageLightbox } from "@/hooks/ui/useImageLightbox";
import {
  useErrorReportFeature,
  useMessageFeedbackFeature,
} from "@/providers/FeatureConfigProvider";
import {
  isPromptInjectionFilterDetails,
  type MessageErrorFilterDetails,
} from "@/types/chat";
import { hasToolCalls as messageHasToolCalls } from "@/utils/adapters/toolCallAdapter";

import { McpNeedsAuthNotice } from "./McpNeedsAuthNotice";
import { MessageAttachments } from "./MessageAttachments";
import { Alert } from "../Feedback/Alert";
import { Avatar } from "../Feedback/Avatar";
import { CopyErrorButton } from "../Feedback/CopyErrorButton";
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
import type { UiChatMessage } from "@/utils/adapters/messageAdapter";

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
}

export const CHAT_MESSAGE_HOST_COMPONENTS: ChatMessageHostComponents = {
  MessageContent,
  LoadingIndicator,
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
  const errorReportConfig = useErrorReportFeature();

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
  const siblingFiles = useMemo(
    () => Object.values(allFilesById),
    [allFilesById],
  );

  // Content validation
  if (message.content.length === 0 && !message.loading && !message.error) {
    return null;
  }

  const attachments =
    message.input_files_ids && message.input_files_ids.length > 0 ? (
      <MessageAttachments
        fileIds={message.input_files_ids}
        filesById={filesById}
        relatedFiles={siblingFiles}
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

          {message.error && (
            <Alert
              type="error"
              title={getErrorTitle(message.error.error_type)}
              geometryVariant="message"
              className="mb-3"
              data-testid="chat-message-error"
            >
              <p>
                {getErrorDescription(
                  message.error.error_type,
                  message.error.filter_details,
                )}
              </p>
              {getErrorCta(
                message.error.error_type,
                message.error.filter_details,
              ) && (
                <p className="mt-2">
                  {getErrorCta(
                    message.error.error_type,
                    message.error.filter_details,
                  )}
                </p>
              )}
              {renderContentFilterDetails(
                message.error.error_type,
                message.error.filter_details,
              )}
              {renderVerboseErrorDescription(
                message.error.error_type,
                message.error.error_description,
                errorReportConfig.showVerboseAssistantErrors,
              )}
              {errorReportConfig.showCopyErrorReport &&
                message.error_report && (
                  <div className="mt-3">
                    <CopyErrorButton report={message.error_report} />
                  </div>
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
            outlookArtifact={message.outlookArtifact}
            // Mentions are a user-message affordance; an assistant echoing
            // "@Name" is quoting, not addressing, so it never highlights.
            mentionedAssistants={
              isUser ? message.mentioned_assistants : undefined
            }
          />

          {/* Only the assistant message of the affected generation carries
              this metadata, so absence costs nothing here. Deliberately keyed
              off needing-auth alone: unavailable servers have no user-side
              remedy, so they must not raise a connect affordance.

              The text renders on every surface — like the error alert above,
              it is part of the record of the response — but the Connect button
              needs the settings-dialog chrome that watches the preferences
              query params, which share-link pages do not mount, hence this
              flag. Routerless hosts (component-kit / add-in) are handled by
              the notice itself, which drops the button when its settings
              hook reports no Router. */}
          {message.mcp_servers_needing_auth &&
            message.mcp_servers_needing_auth.length > 0 && (
              <McpNeedsAuthNotice
                serverIds={message.mcp_servers_needing_auth}
                showConnect={!controlsContext.isSharedDialog}
              />
            )}

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

  if (isPromptInjectionFilterDetails(filterDetails)) {
    return (
      <div className="mt-2 text-xs">
        <div className="font-medium">
          {t({
            id: "chat.message.error.variant.prompt_injection.offending_text",
            message: "Offending text",
          })}
        </div>
        <blockquote className="mt-1 break-words border-l-2 pl-2 italic">
          {filterDetails.matched_text}
        </blockquote>
      </div>
    );
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

const renderVerboseErrorDescription = (
  errorType: string,
  errorDescription: string | undefined,
  showVerboseAssistantErrors: boolean,
) => {
  if (
    !showVerboseAssistantErrors ||
    errorType === "content_filter" ||
    !errorDescription?.trim()
  ) {
    return null;
  }

  return (
    <div className="mt-3 text-xs">
      <div className="font-medium">
        {t({
          id: "chat.message.error.details",
          message: "Details",
        })}
      </div>
      <pre className="mt-1 whitespace-pre-wrap break-words font-sans">
        {errorDescription}
      </pre>
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

const getErrorDescription = (
  errorType: string,
  filterDetails?: MessageErrorFilterDetails | null,
) => {
  if (errorType === "content_filter") {
    if (isPromptInjectionFilterDetails(filterDetails)) {
      return t({
        id: "chat.message.error.variant.prompt_injection",
        message:
          "The request was blocked because it matched a prompt injection guardrail.",
      });
    }

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

  if (errorType === "hallucination_loop") {
    return t({
      id: "chat.message.error.variant.hallucination_loop",
      message:
        "Generation aborted. Hallucination loop detected. Please regenerate the message.",
    });
  }

  return t({
    id: "chat.message.error.variant.default",
    message: "The assistant was unable to respond.",
  });
};

const getErrorCta = (
  errorType: string,
  filterDetails?: MessageErrorFilterDetails | null,
) => {
  if (errorType === "content_filter") {
    if (isPromptInjectionFilterDetails(filterDetails)) {
      return t({
        id: "chat.message.error.variant.prompt_injection.cta",
        message:
          "Please edit the previous message to remove the offending text before continuing.",
      });
    }

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

// Add display name for better debugging
// eslint-disable-next-line lingui/no-unlocalized-strings
ChatMessage.displayName = "ChatMessage";
