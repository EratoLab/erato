import { t } from "@lingui/core/macro";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/Controls/Button";
import { MessageTimestamp } from "@/components/ui/Message/MessageTimestamp";
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
  const { textAlignment, flexAlignment, justifyAlignment } =
    usePageAlignment("headers");

  const handleChatSelect = (chatId: string) => {
    navigate(getChatUrl(chatId, assistant.id));
  };

  const handleEditAssistant = () => {
    navigate(`/assistants/${assistant.id}/edit`);
  };

  return (
    <div
      className={`flex flex-col ${flexAlignment} ${justifyAlignment} p-12 ${className}`}
      data-testid="assistant-welcome-screen-default"
    >
      {/* Assistant Icon/Badge */}
      <div className={`mb-6 flex ${justifyAlignment}`}>
        <div className="flex size-20 items-center justify-center rounded-full bg-theme-bg-accent">
          <EditIcon className="size-10 text-theme-fg-secondary" />
        </div>
      </div>

      {/* Assistant Name */}
      <h1
        className={`mb-2 text-2xl font-bold text-theme-fg-primary ${textAlignment}`}
      >
        {assistant.name}
      </h1>

      {/* Assistant Description */}
      {assistant.description && (
        <p className={`mb-6 text-lg text-theme-fg-secondary ${textAlignment}`}>
          {assistant.description}
        </p>
      )}

      {/* Assistant Details */}
      <div className="mb-8 w-full rounded-lg border border-theme-border bg-theme-bg-primary p-6 text-left">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-theme-fg-muted">
          {t`Configuration`}
        </h2>

        {/* System Prompt Preview */}
        <div className="mb-4">
          <h3 className="mb-2 text-sm font-medium text-theme-fg-secondary">
            {t`System Prompt`}
          </h3>
          <div className="max-h-32 overflow-y-auto rounded border border-theme-border bg-theme-bg-secondary p-3">
            <p className="whitespace-pre-wrap font-mono text-xs text-theme-fg-primary">
              {assistant.prompt.length > 500
                ? `${assistant.prompt.slice(0, 500)}...`
                : assistant.prompt}
            </p>
          </div>
        </div>

        {/* Files */}
        {assistant.files.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-2 text-sm font-medium text-theme-fg-secondary">
              {t`Default Files`} ({assistant.files.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              {assistant.files.map((file) => (
                <span
                  key={file.id}
                  className="rounded bg-theme-bg-accent px-2 py-1 text-xs text-theme-fg-secondary"
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
            variant="ghost"
            size="sm"
            icon={<EditIcon />}
            onClick={handleEditAssistant}
            className="mt-2"
          >
            {t`Edit Assistant Settings`}
          </Button>
        )}
      </div>

      {/* Past Conversations Section */}
      {!isLoadingChats && pastChats.length > 0 && (
        <div className="w-full">
          <h2
            className={`mb-4 text-lg font-semibold text-theme-fg-primary ${textAlignment}`}
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
                className="block rounded-lg border border-theme-border bg-theme-bg-primary p-4 text-left transition-all hover:border-theme-border-focus hover:bg-theme-bg-hover"
              >
                <div className="flex items-center justify-between gap-4">
                  <h3 className="flex-1 truncate font-medium text-theme-fg-primary">
                    {chat.title || t`Untitled Chat`}
                  </h3>
                  <div className="shrink-0 text-xs text-theme-fg-muted">
                    {chat.updatedAt && (
                      <MessageTimestamp createdAt={new Date(chat.updatedAt)} />
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>

          {pastChats.length > 5 && (
            <p className={`mt-4 text-sm text-theme-fg-muted ${textAlignment}`}>
              {t`And`} {pastChats.length - 5} {t`more conversations...`}
            </p>
          )}
        </div>
      )}

      {/* Loading State */}
      {isLoadingChats && (
        <div className="w-full">
          <div className={`flex ${justifyAlignment} py-4`}>
            <div className="size-6 animate-spin rounded-full border-2 border-theme-border border-t-transparent"></div>
          </div>
        </div>
      )}

      {/* Start New Conversation Hint */}
      <div className={`mt-8 text-theme-fg-muted ${textAlignment}`}>
        <p className="text-sm">{t`Start typing below to begin a new conversation`}</p>
      </div>
    </div>
  );
}
