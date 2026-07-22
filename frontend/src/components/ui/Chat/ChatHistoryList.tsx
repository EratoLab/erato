import { t } from "@lingui/core/macro";
import { Plural } from "@lingui/react/macro";
import clsx from "clsx";
import { memo, useEffect, useRef } from "react";

import { MessageTimestamp } from "@/components/ui";
import { useHasPendingConfirmation } from "@/hooks/chat/store/confirmationRegistryStore";
import { useGenerationStatusFor } from "@/hooks/chat/store/generationStatusStore";
import { useThemedIcon } from "@/hooks/ui";
import { getChatUrl } from "@/utils/chat/urlUtils";
import { createLogger } from "@/utils/debugLogger";

import { InteractiveContainer } from "../Container/InteractiveContainer";
import { DropdownMenu } from "../Controls/DropdownMenu";
import {
  LogOutIcon,
  ResolvedIcon,
  MultiplePagesIcon,
  ShareIcon,
} from "../icons";

import type { ChatSession } from "@/types/chat";

const logger = createLogger("UI", "ChatHistoryList");
const sidebarRowLinkClassName =
  "focus-ring-tight block rounded-[var(--theme-radius-shell)]";

const ChatItemIcon = memo(() => {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal theme icon identifier, not user-facing text
  const chatItemIconId = useThemedIcon("navigation", "chatItem");

  // Only render if theme provides a custom icon
  if (!chatItemIconId) return null;

  return (
    <ResolvedIcon
      iconId={chatItemIconId}
      fallbackIcon={MultiplePagesIcon}
      className="size-4 shrink-0 text-theme-fg-secondary"
    />
  );
});

// eslint-disable-next-line lingui/no-unlocalized-strings -- Component display name, not user-facing text
ChatItemIcon.displayName = "ChatItemIcon";

type RowGenerationStatus = "running" | "finished" | "error" | "action_required";

/**
 * Resolves a row's generation indicator from the stores. An unresolved tool
 * confirmation outranks the generation state — the turn is waiting on the
 * user, not on the model.
 */
const useRowGenerationStatus = (chatId: string): RowGenerationStatus | null => {
  const status = useGenerationStatusFor(chatId);
  const hasPendingConfirmation = useHasPendingConfirmation(chatId);
  // eslint-disable-next-line lingui/no-unlocalized-strings -- status token, not user-facing text
  if (hasPendingConfirmation) return "action_required";
  return status?.kind ?? null;
};

const rowGenerationStatusLabel = (status: RowGenerationStatus): string => {
  switch (status) {
    case "running":
      return t({ id: "chat.history.generation.running", message: "Running" });
    case "finished":
      return t({ id: "chat.history.generation.finished", message: "Finished" });
    case "error":
      return t({ id: "chat.history.generation.error", message: "Error" });
    case "action_required":
      return t({
        id: "chat.history.generation.actionRequired",
        message: "Action required",
      });
  }
};

const rowGenerationStatusTextClass: Record<RowGenerationStatus, string> = {
  running: "text-theme-fg-muted",
  finished: "text-theme-success-fg",
  error: "text-theme-error-fg",
  action_required: "text-theme-warning-fg",
};

const GenerationStatusIndicator = memo<{ chatId: string }>(({ chatId }) => {
  const status = useRowGenerationStatus(chatId);

  if (!status) return null;

  return (
    <span
      className={clsx(
        "flex shrink-0 items-center gap-1 text-xs",
        rowGenerationStatusTextClass[status],
      )}
      data-ui="chat-history-generation-status"
      data-testid="chat-generation-status"
      data-status={status}
    >
      <span
        aria-hidden="true"
        className={clsx(
          "size-1.5 rounded-full bg-current",
          status === "running" && "animate-pulse motion-reduce:animate-none",
        )}
      />
      {rowGenerationStatusLabel(status)}
    </span>
  );
});

// eslint-disable-next-line lingui/no-unlocalized-strings
GenerationStatusIndicator.displayName = "GenerationStatusIndicator";

export interface ChatHistoryListProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onSessionArchive?: (sessionId: string) => void;
  onSessionEditTitle?: (sessionId: string) => void;
  onSessionShare?: (sessionId: string) => void;
  onShowDetails?: (sessionId: string) => void;
  className?: string;
  /**
   * Layout configuration
   * @default "default"
   */
  layout?: "default" | "compact";
  /**
   * Whether to show timestamps
   * @default true
   */
  showTimestamps?: boolean;
  /**
   * Whether the list is in a loading state
   * @default false
   */
  isLoading?: boolean;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

const ChatHistoryListItem = memo<{
  session: ChatSession;
  isActive: boolean;
  layout: "default" | "compact";
  onSelect: () => void;
  onArchive?: () => void;
  onEditTitle?: () => void;
  onShare?: () => void;
  canEdit?: boolean;
  onShowDetails?: () => void;
  showTimestamps?: boolean;
}>(
  ({
    session,
    isActive,
    layout,
    onSelect,
    onArchive,
    onEditTitle,
    onShare,
    canEdit = true,
    onShowDetails,
    showTimestamps = true,
  }) => {
    const generationStatus = useRowGenerationStatus(session.id);
    const rowTitle = session.title || t`New Chat`;
    return (
      <a
        href={getChatUrl(session.id, session.assistantId)}
        onClick={(e) => {
          // Allow cmd/ctrl-click to open in new tab
          if (e.metaKey || e.ctrlKey) {
            return;
          }
          // Prevent default navigation for normal clicks
          e.preventDefault();
          onSelect();
        }}
        className={sidebarRowLinkClassName}
        aria-label={
          generationStatus
            ? `${rowTitle}, ${rowGenerationStatusLabel(generationStatus)}`
            : rowTitle
        }
        aria-current={isActive ? "page" : undefined}
      >
        <InteractiveContainer
          useDiv={true}
          showFocusRing={false}
          className={clsx(
            "sidebar-row-geometry theme-transition flex flex-col px-3 py-1.5 pb-3.5 pr-1.5 text-left",
            isActive
              ? "sidebar-row-selected"
              : "hover:bg-[var(--theme-shell-sidebar-hover)]",
            layout === "compact" ? "gap-0.5" : "gap-1",
          )}
          data-chat-id={session.id}
          data-ui="chat-history-item"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <GenerationStatusIndicator chatId={session.id} />
              <ChatItemIcon />
              <span className="truncate font-medium" title={rowTitle}>
                {rowTitle}
              </span>
            </div>
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- div exists to prevent bubbling */}
            <div
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <DropdownMenu
                items={[
                  ...(onShare
                    ? [
                        {
                          label: t({
                            id: "chat.share.button",
                            message: "Share",
                          }),
                          icon: <ShareIcon className="size-4" />,
                          onClick: onShare,
                          disabled: !canEdit,
                        },
                      ]
                    : []),
                  ...(onEditTitle
                    ? [
                        {
                          label: t({
                            id: "chat.history.menu.rename",
                            message: "Rename",
                          }),
                          icon: <MultiplePagesIcon className="size-4" />,
                          onClick: onEditTitle,
                          disabled: !canEdit,
                        },
                      ]
                    : []),
                  {
                    label: t`Remove`,
                    icon: <LogOutIcon className="size-4" />,
                    onClick: onArchive ?? (() => {}),
                    confirmAction: true,
                    confirmTitle: t`Confirm Removal`,
                    confirmMessage: t`Are you sure you want to remove this chat?`,
                  },
                ]}
              />
            </div>
          </div>
          {layout !== "compact" && showTimestamps && (
            <>
              <p
                className={clsx(
                  "truncate text-xs",
                  session.metadata?.fileCount == 0
                    ? "text-theme-fg-muted"
                    : "text-theme-fg-secondary",
                )}
                title={
                  session.metadata?.fileCount === 0
                    ? t`No files`
                    : session.metadata?.fileCount === 1
                      ? t`1 file`
                      : `${session.metadata?.fileCount ?? 0} files`
                }
              >
                <Plural
                  value={session.metadata?.fileCount ?? 0}
                  _0="No files"
                  one="# file"
                  other="# files"
                />
              </p>
              {session.updatedAt && (
                <p className="text-xs text-theme-fg-secondary">
                  <MessageTimestamp createdAt={new Date(session.updatedAt)} />
                </p>
              )}
            </>
          )}
        </InteractiveContainer>
      </a>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
ChatHistoryListItem.displayName = "ChatHistoryListItem";

export const ChatHistoryList = memo<ChatHistoryListProps>(
  ({
    sessions,
    currentSessionId,
    onSessionSelect,
    onSessionArchive,
    onSessionEditTitle,
    onSessionShare,
    onShowDetails,
    className,
    layout = "default",
    isLoading = false,
    hasMore = false,
    isLoadingMore = false,
    onLoadMore,
    showTimestamps = true,
  }) => {
    const currentSession = sessions.find((s) => s.id === currentSessionId);
    const currentSessionTitle = currentSession?.title;
    const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      if (typeof currentSessionTitle === "undefined") {
        return;
      }
      const pageTitle = t({ id: "branding.page_title_suffix" });
      document.title = `${currentSessionTitle} - ${pageTitle}`;
    }, [currentSessionTitle]);

    useEffect(() => {
      const sentinel = loadMoreSentinelRef.current;
      if (!sentinel || !hasMore || !onLoadMore) {
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting) && !isLoadingMore) {
            onLoadMore();
          }
        },
        { rootMargin: "120px" }, // eslint-disable-line lingui/no-unlocalized-strings -- IntersectionObserver CSS length, not user-facing text
      );

      observer.observe(sentinel);
      return () => observer.disconnect();
    }, [hasMore, isLoadingMore, onLoadMore]);

    if (isLoading) {
      return <ChatHistoryListSkeleton layout={layout} />;
    }

    return (
      <div
        className={clsx(
          // No overflow-y here: the sidebar wrapper (ChatHistorySidebar) owns the
          // single scroll region; a second scroller caused rare double scrollbars.
          "flex w-full min-w-0 flex-col gap-1",
          className,
        )}
        data-ui="chat-history-list"
      >
        {sessions.map((session) => (
          <ChatHistoryListItem
            key={session.id}
            session={session}
            isActive={currentSessionId === session.id}
            layout={layout}
            showTimestamps={showTimestamps}
            onSelect={() => {
              logger.log(`Session item click: ${session.id}`);
              onSessionSelect(session.id);
            }}
            onArchive={
              onSessionArchive ? () => onSessionArchive(session.id) : undefined
            }
            onEditTitle={
              onSessionEditTitle
                ? () => onSessionEditTitle(session.id)
                : undefined
            }
            onShare={
              onSessionShare ? () => onSessionShare(session.id) : undefined
            }
            canEdit={session.canEdit}
            onShowDetails={
              onShowDetails ? () => onShowDetails(session.id) : undefined
            }
          />
        ))}
        {hasMore && (
          <div
            ref={loadMoreSentinelRef}
            className="flex justify-center py-2"
            data-ui="chat-history-load-more-sentinel"
            aria-label={t`Loading...`}
          >
            {isLoadingMore && (
              <div className="size-4 animate-spin rounded-full border-2 border-theme-border border-t-transparent" />
            )}
          </div>
        )}
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
ChatHistoryList.displayName = "ChatHistoryList";

export const ChatHistoryListSkeleton = ({
  layout = "default",
}: {
  layout?: "default" | "compact";
}) => (
  <div
    data-testid="chat-history-skeleton"
    className="chat-history-list-geometry flex w-full min-w-0 flex-col gap-1 overflow-y-auto bg-[var(--theme-shell-sidebar)]"
  >
    {Array.from({ length: 5 }, (_, i) => (
      <div
        key={i}
        data-testid="chat-history-skeleton-item"
        className="sidebar-row-geometry sidebar-row-selected w-full px-4 py-3"
      >
        <div className="flex w-full items-center justify-between gap-2">
          <div className="h-5 w-2/3 animate-pulse rounded bg-theme-bg-accent" />
          <div className="size-8 shrink-0 animate-pulse rounded bg-theme-bg-accent" />
        </div>
        {layout !== "compact" && (
          <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-theme-bg-accent" />
        )}
      </div>
    ))}
  </div>
);
