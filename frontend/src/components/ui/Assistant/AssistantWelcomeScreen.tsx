import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/Controls/Button";
import { DropdownMenu } from "@/components/ui/Controls/DropdownMenu";
import { SegmentedControl } from "@/components/ui/Controls/SegmentedControl";
import { Alert } from "@/components/ui/Feedback/Alert";
import { MessageTimestamp } from "@/components/ui/Message/MessageTimestamp";
import { ModalBase } from "@/components/ui/Modal/ModalBase";
import { EditIcon, PinIcon, PinSlashIcon } from "@/components/ui/icons";
import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { usePageAlignment } from "@/hooks/ui/usePageAlignment";
import {
  DELEGATION_PROVENANCE_KIND,
  UNTITLED_BACKEND_SENTINEL,
} from "@/utils/chat/recentChatSession";
import { getChatUrl } from "@/utils/chat/urlUtils";
import {
  chatAttentionStatusLabel,
  chatAttentionStatusToneClass,
  mostUrgentAttentionStatus,
  resolveChatAttentionStatus,
} from "@/utils/chatHistoryGrouping";

import type { SegmentedControlOption } from "@/components/ui/Controls/SegmentedControl";
import type { AssistantWithFiles } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "@/types/chat";
import type { ChatAttentionStatus } from "@/utils/chatHistoryGrouping";

export interface AssistantWelcomeScreenProps {
  /** The assistant this chat space is for */
  assistant: AssistantWithFiles;
  /** Past chats with this assistant */
  pastChats?: ChatSession[];
  /** Runs this assistant carried out on behalf of another chat */
  delegatedRuns?: ChatSession[];
  /**
   * Whether delegation is available at all. Keeps the delegated segment
   * reachable before the assistant has ever been delegated to.
   */
  delegationEnabled?: boolean;
  /** Whether past chats are loading */
  isLoadingChats?: boolean;
  /** Optional pin action for the past conversation cards */
  onChatPin?: (chatId: string, isPinned: boolean) => void;
  /** Number of currently pinned chats */
  pinnedChatsCount?: number;
  /** Maximum number of pinned chats */
  pinnedChatsLimit?: number;
  /** Additional CSS classes */
  className?: string;
}

type AssistantChatSegment = "chats" | "delegated";

const PAST_CHAT_PREVIEW_COUNT = 5;

/**
 * The screen unmounts as soon as a conversation is opened, so the selected
 * segment has to survive in the URL to still be there on the way back.
 */
const SEGMENT_SEARCH_PARAM = "segment";

/** The status a single indicator has to stand for across a set of rows. */
const useSessionsAttentionStatus = (
  sessions: ChatSession[],
): ChatAttentionStatus | null => {
  const statusByChatId = useGenerationStatusStore(
    (state) => state.statusByChatId,
  );
  const pendingIdsByChatId = useConfirmationRegistryStore(
    (state) => state.pendingIdsByChatId,
  );
  return useMemo(
    () =>
      mostUrgentAttentionStatus(
        sessions.flatMap((session) => {
          const status = resolveChatAttentionStatus(
            statusByChatId[session.id],
            (pendingIdsByChatId[session.id]?.length ?? 0) > 0,
          );
          return status ? [status] : [];
        }),
      ),
    [sessions, statusByChatId, pendingIdsByChatId],
  );
};

const originLabel = ({
  provenanceKind,
  originChatId,
  originChatTitle,
}: ChatSession): string | null => {
  if (provenanceKind !== DELEGATION_PROVENANCE_KIND) {
    return null;
  }
  if (originChatTitle === UNTITLED_BACKEND_SENTINEL) {
    return t({
      id: "assistant.welcome.delegated.origin.untitled",
      message: "From an untitled conversation",
    });
  }
  if (originChatTitle) {
    return t({
      id: "assistant.welcome.delegated.origin",
      message: `From ${originChatTitle}`,
    });
  }
  if (originChatId) {
    return t({
      id: "assistant.welcome.delegated.origin.deleted",
      message: "From a conversation that no longer exists",
    });
  }
  return null;
};

/** The mappers' localized fallback still lets the backend sentinel through. */
const rowTitle = ({ title, titleResolved }: ChatSession): string => {
  const backendTitle = titleResolved ?? title;
  return backendTitle && backendTitle !== UNTITLED_BACKEND_SENTINEL
    ? backendTitle
    : t({ id: "chat.newChat.title", message: "New Chat" });
};

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
  delegatedRuns = [],
  delegationEnabled = false,
  isLoadingChats = false,
  onChatPin,
  pinnedChatsCount = 0,
  pinnedChatsLimit = 5,
  className = "",
}: AssistantWelcomeScreenProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isConfigurationOpen, setIsConfigurationOpen] = useState(false);
  const selectedSegment: AssistantChatSegment =
    searchParams.get(SEGMENT_SEARCH_PARAM) === "delegated"
      ? "delegated"
      : "chats";
  const selectSegment = (next: AssistantChatSegment) => {
    const nextParams = new URLSearchParams(searchParams);
    if (next === "delegated") {
      nextParams.set(SEGMENT_SEARCH_PARAM, next);
    } else {
      nextParams.delete(SEGMENT_SEARCH_PARAM);
    }
    setSearchParams(nextParams, { replace: true });
  };
  const {
    containerClasses: contentContainerClasses,
    textAlignment: contentTextAlignment,
    justifyAlignment: contentJustifyAlignment,
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

  const delegatedAttention = useSessionsAttentionStatus(delegatedRuns);
  // An empty second segment is noise unless delegation can still fill it.
  const showSegments = delegatedRuns.length > 0 || delegationEnabled;
  const segment = showSegments ? selectedSegment : "chats";
  const visibleChats = segment === "delegated" ? delegatedRuns : pastChats;
  const segmentOptions: SegmentedControlOption<AssistantChatSegment>[] = [
    {
      value: "chats",
      label: t({ id: "assistant.welcome.segment.chats", message: "Chats" }),
    },
    {
      value: "delegated",
      label: t({
        id: "assistant.welcome.segment.delegated",
        message: "Delegated runs",
      }),
      ...(delegatedAttention
        ? {
            attention: {
              label: chatAttentionStatusLabel(delegatedAttention),
              toneClassName: chatAttentionStatusToneClass[delegatedAttention],
              pulse: delegatedAttention === "running",
            },
          }
        : {}),
    },
  ];

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
                // Control radius, not shell: this is a bare text affordance
                // with no padding or fill, so the radius only shapes the focus
                // ring. A card radius made that ring capsule-ish on one line
                // of text.
                "focus-ring-tight rounded-[var(--theme-radius-control)] text-2xl font-bold text-theme-fg-primary hover:text-theme-fg-accent",
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
        {!isLoadingChats &&
          (pastChats.length > 0 || delegatedRuns.length > 0) && (
            <div className="w-full">
              <div
                className={clsx(
                  "mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4",
                  contentJustifyAlignment,
                )}
              >
                <h2
                  className={clsx(
                    "text-lg font-semibold text-theme-fg-primary",
                    contentTextAlignment,
                  )}
                >
                  {t`Your conversations with this assistant`}
                </h2>
                {showSegments && (
                  <SegmentedControl
                    options={segmentOptions}
                    value={segment}
                    onChange={selectSegment}
                    aria-label={t({
                      id: "assistant.welcome.segment.aria",
                      message: "Filter conversations",
                    })}
                  />
                )}
              </div>
              {visibleChats.length === 0 && (
                <p
                  className={clsx(
                    "text-sm text-theme-fg-muted",
                    contentTextAlignment,
                  )}
                >
                  {segment === "delegated"
                    ? t({
                        id: "assistant.welcome.delegated.empty",
                        message: "No delegated runs yet.",
                      })
                    : t({
                        id: "assistant.welcome.chats.empty",
                        message: "No direct conversations yet.",
                      })}
                </p>
              )}
              {visibleChats.length > 0 && (
                <div className="space-y-2">
                  {visibleChats
                    .slice(0, PAST_CHAT_PREVIEW_COUNT)
                    .map((chat) => {
                      const origin = originLabel(chat);
                      return (
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
                              {rowTitle(chat)}
                            </h3>
                            <div className="shrink-0 text-xs text-theme-fg-muted">
                              {chat.updatedAt && (
                                <MessageTimestamp
                                  createdAt={new Date(chat.updatedAt)}
                                />
                              )}
                            </div>
                            {onChatPin && (
                              // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- div exists to prevent anchor navigation from menu clicks
                              <div
                                className="shrink-0"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                              >
                                <DropdownMenu
                                  items={[
                                    {
                                      label: chat.isPinned
                                        ? t({
                                            id: "chat.history.menu.unpin",
                                            message: "Unpin",
                                          })
                                        : pinnedChatsCount >= pinnedChatsLimit
                                          ? t({
                                              id: "chat.history.menu.pinLimitReached",
                                              message: "Pin limit reached",
                                            })
                                          : t({
                                              id: "chat.history.menu.pin",
                                              message: "Pin",
                                            }),
                                      icon: chat.isPinned ? (
                                        <PinSlashIcon className="size-4" />
                                      ) : (
                                        <PinIcon className="size-4" />
                                      ),
                                      onClick: () =>
                                        onChatPin(chat.id, !chat.isPinned),
                                      disabled:
                                        !chat.canEdit ||
                                        (!chat.isPinned &&
                                          pinnedChatsCount >= pinnedChatsLimit),
                                    },
                                  ]}
                                />
                              </div>
                            )}
                          </div>
                          {origin && (
                            <p
                              className="mt-1 truncate text-xs text-theme-fg-muted"
                              data-ui="assistant-delegated-run-origin"
                            >
                              {origin}
                            </p>
                          )}
                        </a>
                      );
                    })}
                </div>
              )}

              {visibleChats.length > PAST_CHAT_PREVIEW_COUNT && (
                <p
                  className={clsx(
                    "mt-4 text-sm text-theme-fg-muted",
                    contentTextAlignment,
                  )}
                >
                  {t`And`} {visibleChats.length - PAST_CHAT_PREVIEW_COUNT}{" "}
                  {t`more conversations...`}
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
