import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { MessageTimestamp } from "@/components/ui/Message/MessageTimestamp";
import { ModalBase } from "@/components/ui/Modal/ModalBase";
import { EditIcon } from "@/components/ui/icons";
import { usePageAlignment } from "@/hooks/ui/usePageAlignment";
import { getChatUrl } from "@/utils/chat/urlUtils";

import type { AssistantWithFiles } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "@/types/chat";

export interface AssistantWelcomeScreenProps {
  /** The assistant this chat space is for */
  assistant: AssistantWithFiles;
  /** Past chats with this assistant */
  pastChats?: ChatSession[];
  /** Whether past chats are loading */
  isLoadingChats?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * AssistantWelcomeScreen component
 *
 * Displayed when viewing an assistant's chat space with no active conversation.
 * Shows assistant information and past conversations with this assistant.
 *
 * @example
 * ```tsx
 * <AssistantWelcomeScreen
 *   assistant={assistantData}
 *   pastChats={filteredChats}
 * />
 * ```
 */
export function AssistantWelcomeScreen({
  assistant,
  pastChats = [],
  isLoadingChats = false,
  className = "",
}: AssistantWelcomeScreenProps) {
  const navigate = useNavigate();
  const [isConfigurationOpen, setIsConfigurationOpen] = useState(false);
  const {
    containerClasses: contentContainerClasses,
    textAlignment: contentTextAlignment,
    horizontalPadding: contentHorizontalPadding,
  } = usePageAlignment("assistants");
  const {
    containerClasses: headerContainerClasses,
    textAlignment: headerTextAlignment,
    justifyAlignment: headerJustifyAlignment,
  } = usePageAlignment("headers");

  const handleChatSelect = (chatId: string) => {
    navigate(getChatUrl(chatId, assistant.id));
  };

  const handleEditAssistant = () => {
    navigate(`/assistants/${assistant.id}/edit`);
  };

  const inaccessibleFiles = assistant.files.filter(
    (file) => file.file_contents_unavailable_missing_permissions,
  );
  const assistantInitial = useMemo(() => {
    const trimmedName = assistant.name.trim();
    return (trimmedName.charAt(0) || "A").toLocaleUpperCase();
  }, [assistant.name]);
  const openConfiguration = () => setIsConfigurationOpen(true);
  const closeConfiguration = () => setIsConfigurationOpen(false);
  const configurationLabel = t({
    id: "assistant.welcome.configuration.open",
    message: "View assistant configuration",
  });

  return (
    <div
      className={clsx(
        "w-full py-8 sm:py-12",
        contentHorizontalPadding,
        className,
      )}
      data-testid="assistant-welcome-screen-default"
    >
      <div className={clsx("flex w-full flex-col", contentContainerClasses)}>
        <div className={clsx("mb-8 w-full", headerContainerClasses)}>
          {/* Assistant Icon/Badge */}
          <div className={clsx("mb-6 flex", headerJustifyAlignment)}>
            <button
              type="button"
              onClick={openConfiguration}
              className="focus-ring flex size-20 items-center justify-center rounded-full bg-theme-avatar-assistant-bg text-3xl font-semibold text-theme-avatar-assistant-fg transition-transform hover:scale-105"
              aria-label={configurationLabel}
              data-testid="assistant-welcome-avatar-button"
            >
              <span data-testid="assistant-welcome-avatar-initial">
                {assistantInitial}
              </span>
            </button>
          </div>

          {/* Assistant Name */}
          <h1 className={clsx("mb-2", headerTextAlignment)}>
            <button
              type="button"
              onClick={openConfiguration}
              className={clsx(
                "focus-ring-tight rounded-[var(--theme-radius-shell)] text-2xl font-bold text-theme-fg-primary hover:text-theme-fg-accent",
                headerTextAlignment,
              )}
              title={configurationLabel}
            >
              {assistant.name}
            </button>
          </h1>

          {/* Assistant Description */}
          {assistant.description && (
            <p
              className={clsx(
                "text-lg text-theme-fg-secondary",
                headerTextAlignment,
              )}
            >
              {assistant.description}
            </p>
          )}
        </div>

        <ModalBase
          isOpen={isConfigurationOpen}
          onClose={closeConfiguration}
          title={t`Configuration`}
          contentClassName="max-w-2xl"
        >
          <div className="space-y-5 text-left" data-ui="assistant-detail-card">
            {inaccessibleFiles.length > 0 ? (
              <Alert type="warning">
                {assistant.owner_email ? (
                  <>
                    {t({
                      id: "assistant.welcome.files.inaccessible",
                      message:
                        "Some default files are inaccessible due to missing permissions.",
                    })}{" "}
                    {t({
                      id: "assistant.welcome.files.inaccessible.contact",
                      message:
                        "Contact this creator and ask them to share the files:",
                    })}{" "}
                    <a
                      href={`mailto:${assistant.owner_email}`}
                      className="font-medium text-theme-fg-accent underline"
                    >
                      {assistant.owner_email}
                    </a>
                  </>
                ) : (
                  t({
                    id: "assistant.welcome.files.inaccessible",
                    message:
                      "Some default files are inaccessible due to missing permissions.",
                  })
                )}
              </Alert>
            ) : null}

            {/* System Prompt Preview */}
            <div>
              <h3 className="mb-2 text-sm font-medium text-theme-fg-secondary">
                {t`System Prompt`}
              </h3>
              <div className="max-h-48 overflow-y-auto rounded-[var(--theme-radius-message)] border border-theme-border bg-theme-bg-secondary p-3">
                <p className="whitespace-pre-wrap font-mono text-xs text-theme-fg-primary">
                  {assistant.prompt.length > 500
                    ? `${assistant.prompt.slice(0, 500)}...`
                    : assistant.prompt}
                </p>
              </div>
            </div>

            {/* Files */}
            {assistant.files.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-medium text-theme-fg-secondary">
                  {t`Default Files`} ({assistant.files.length})
                </h3>
                <div className="flex flex-wrap gap-2">
                  {assistant.files.map((file) => (
                    <span
                      key={file.id}
                      className="rounded-[var(--theme-radius-pill)] bg-theme-bg-accent px-2 py-1 text-xs text-theme-fg-secondary"
                    >
                      {file.filename}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Edit Assistant Button - only show if user can edit */}
            {assistant.can_edit && (
              <Button
                variant="secondary"
                size="sm"
                icon={<EditIcon />}
                onClick={handleEditAssistant}
              >
                {t`Edit Assistant Settings`}
              </Button>
            )}
          </div>
        </ModalBase>

        {/* Past Conversations Section */}
        {!isLoadingChats && pastChats.length > 0 && (
          <div className="w-full">
            <h2
              className={clsx(
                "mb-4 text-lg font-semibold text-theme-fg-primary",
                contentTextAlignment,
              )}
            >
              {t`Your conversations with this assistant`}
            </h2>
            <div className="space-y-2">
              {pastChats.slice(0, 5).map((chat) => (
                <a
                  key={chat.id}
                  href={getChatUrl(chat.id, assistant.id)}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey) return;
                    e.preventDefault();
                    handleChatSelect(chat.id);
                  }}
                  data-ui="assistant-past-chat-card"
                  className="block rounded-[var(--theme-radius-shell)] bg-theme-bg-primary p-4 text-left transition-all hover:bg-theme-bg-hover"
                >
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="flex-1 truncate font-medium text-theme-fg-primary">
                      {chat.title || t`Untitled Chat`}
                    </h3>
                    <div className="shrink-0 text-xs text-theme-fg-muted">
                      {chat.updatedAt && (
                        <MessageTimestamp
                          createdAt={new Date(chat.updatedAt)}
                        />
                      )}
                    </div>
                  </div>
                </a>
              ))}
            </div>

            {pastChats.length > 5 && (
              <p
                className={clsx(
                  "mt-4 text-sm text-theme-fg-muted",
                  contentTextAlignment,
                )}
              >
                {t`And`} {pastChats.length - 5} {t`more conversations...`}
              </p>
            )}
          </div>
        )}

        {/* Loading State */}
        {isLoadingChats && (
          <div className="w-full">
            <div className={clsx("flex py-4", headerJustifyAlignment)}>
              <div className="size-6 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
            </div>
          </div>
        )}

        {/* Start New Conversation Hint */}
        <div className={clsx("mt-8 text-theme-fg-muted", contentTextAlignment)}>
          <p className="text-sm">
            {t`Start typing below to begin a new conversation`}
          </p>
        </div>
      </div>
    </div>
  );
}
