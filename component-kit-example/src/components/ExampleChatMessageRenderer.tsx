// Resolved via the host's import map to the app-bundle module — the host's
// theme/feature-config providers apply directly, so no local provider
// wrappers (the old workaround for bundled duplicate contexts) are needed.
import { MessageContent } from "@erato/frontend/shared";

import type {
  ComponentRegistry,
  ContentPart,
  FileUploadItem,
  UiChatMessage,
} from "@erato/frontend/library";

const filesByIdFromMessage = (
  allFilesById: Record<string, FileUploadItem> | undefined,
): Record<string, FileUploadItem> => allFilesById ?? {};

const contentPartsFromMessage = (
  content: UiChatMessage["content"],
): ContentPart[] => {
  if (Array.isArray(content)) {
    return content;
  }

  if (typeof content === "string") {
    return [{ content_type: "text", text: content } as ContentPart];
  }

  return [];
};

export const ExampleChatMessageRenderer: NonNullable<
  ComponentRegistry["ChatMessageRenderer"]
> = ({
  message,
  controls: Controls,
  controlsContext,
  onMessageAction,
  onFilePreview,
  allFilesById,
  userDisplayNameOverride,
}) => {
  const isUser = message.role === "user";
  const senderLabel =
    userDisplayNameOverride ?? message.sender ?? (isUser ? "You" : "Assistant");

  return (
    <article
      data-component-kit="example"
      className="erato-component-kit-example-message"
      role="log"
      aria-live="polite"
      aria-label={`${senderLabel} message`}
      data-message-id={message.id}
      data-role={isUser ? "user" : "assistant"}
    >
      <div className="erato-component-kit-example-message-boundary">
        --- MESSAGE START ---
      </div>

      <div className="erato-component-kit-example-message-body">
        <div className="erato-component-kit-example-message-sender">
          {senderLabel}
        </div>

        <MessageContent
          content={contentPartsFromMessage(message.content)}
          messageId={message.id}
          filesById={filesByIdFromMessage(allFilesById)}
          isStreaming={!!message.loading && message.loading.state !== "done"}
          onFileLinkPreview={onFilePreview}
          preserveSoftLineBreaks={isUser}
          createdAt={message.createdAt}
          updatedAt={message.updatedAt}
          hasError={!!message.error}
          outlookArtifact={message.outlookArtifact}
        />

        {Controls ? (
          <div className="erato-component-kit-example-message-controls">
            <Controls
              messageId={message.id}
              messageType={message.sender}
              createdAt={message.createdAt}
              isUserMessage={isUser}
              onAction={onMessageAction}
              context={controlsContext}
            />
          </div>
        ) : null}
      </div>

      <div className="erato-component-kit-example-message-boundary">
        --- MESSSAGE END ---
      </div>
    </article>
  );
};
