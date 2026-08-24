import { t } from "@lingui/core/macro";
import { Plural } from "@lingui/react/macro";
import clsx from "clsx";
import { memo, useEffect, useMemo, useRef } from "react";

import { MessageTimestamp } from "@/components/ui";
import { useHasPendingConfirmation } from "@/hooks/chat/store/confirmationRegistryStore";
import { useGenerationStatusFor } from "@/hooks/chat/store/generationStatusStore";
import { useChatHistoryStore } from "@/hooks/chat/useChatHistory";
import { useThemedIcon } from "@/hooks/ui";
import { resolveRecentChatTitle } from "@/utils/chat/recentChatSession";
import { getChatUrl } from "@/utils/chat/urlUtils";
import {
  chatAttentionStatusLabel,
  resolveChatAttentionStatus,
} from "@/utils/chatHistoryGrouping";
import { createLogger } from "@/utils/debugLogger";

import { ChatAttentionStatusDot } from "./ChatAttentionStatusDot";
import { InteractiveContainer } from "../Container/InteractiveContainer";
import { DropdownMenu } from "../Controls/DropdownMenu";
import {
  EditIcon,
  ResolvedIcon,
  MultiplePagesIcon,
  PinIcon,
  PinSlashIcon,
  ShareIcon,
  Trash,
} from "../icons";

import type { ChatSession } from "@/types/chat";
import type { ChatAttentionStatus } from "@/utils/chatHistoryGrouping";

const logger = createLogger("UI", "ChatHistoryList");
// Inset ring: the outside-drawn variant gets clipped by the sidebar
// scrollport whenever the themeable row inset is below the ring width.
const sidebarRowLinkClassName =
  "focus-ring-inset block rounded-[var(--theme-radius-shell)]";

/**
 * Row title: a real backend title, else the recorded user-message hint, else
 * a localized placeholder. Reads `titleResolved` (the raw backend value)
 * rather than `title`, which the session mappers fill with their own
 * localized fallback.
 */
const useRowTitle = (session: ChatSession): string => {
  const titleHint = useChatHistoryStore(
    (state) => state.titleHintByChatId[session.id],
  );
  return (
    resolveRecentChatTitle(session.titleResolved ?? session.title) ??
    titleHint ??
    t`New Chat`
  );
};

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

const useRowGenerationStatus = (chatId: string): ChatAttentionStatus | null => {
  const status = useGenerationStatusFor(chatId);
  const hasPendingConfirmation = useHasPendingConfirmation(chatId);
  return resolveChatAttentionStatus(status, hasPendingConfirmation);
};

const GenerationStatusIndicator = memo<{ chatId: string }>(({ chatId }) => {
  const status = useRowGenerationStatus(chatId);

  if (!status) return null;

  return <ChatAttentionStatusDot status={status} />;
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
  onSessionPin?: (sessionId: string, isPinned: boolean) => void;
  pinnedChatsCount?: number;
  pinnedChatsLimit?: number;
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
  /**
   * For hosts that serve no chat routes (the add-in pane): rows render
   * without hrefs, and every activation — modified clicks included — goes
   * through onSessionSelect.
   */
  disableRowLinks?: boolean;
}

const ChatHistoryListItem = memo<{
  session: ChatSession;
  isActive: boolean;
  layout: "default" | "compact";
  onSelect: () => void;
  onArchive?: () => void;
  onEditTitle?: () => void;
  onShare?: () => void;
  onPin?: () => void;
  isPinned?: boolean;
  pinnedChatsCount: number;
  pinnedChatsLimit: number;
  canEdit?: boolean;
  onShowDetails?: () => void;
  showTimestamps?: boolean;
  disableRowLinks?: boolean;
}>(
  ({
    session,
    isActive,
    layout,
    onSelect,
    onArchive,
    onEditTitle,
    onShare,
    onPin,
    isPinned = false,
    pinnedChatsCount,
    pinnedChatsLimit,
    canEdit = true,
    onShowDetails,
    showTimestamps = true,
    disableRowLinks = false,
  }) => {
    const generationStatus = useRowGenerationStatus(session.id);
    const rowTitle = useRowTitle(session);
    // A stable Date instance: an inline `new Date(...)` would defeat
    // MessageTimestamp's shallow memo on every list render.
    const updatedAtDate = useMemo(
      () => (session.updatedAt ? new Date(session.updatedAt) : null),
      [session.updatedAt],
    );
    const isPinLimitReached = !isPinned && pinnedChatsCount >= pinnedChatsLimit;
    const pinMenuLabel = isPinLimitReached
      ? t({
          id: "chat.history.menu.pinLimitReached",
          message: "Pin limit reached",
        })
      : isPinned
        ? t({
            id: "chat.history.menu.unpin",
            message: "Unpin",
          })
        : t({
            id: "chat.history.menu.pin",
            message: "Pin",
          });
    const rowAriaLabel = generationStatus
      ? `${rowTitle}, ${chatAttentionStatusLabel(generationStatus)}`
      : rowTitle;
    const rowBody = (
      <InteractiveContainer
        useDiv={true}
        showFocusRing={false}
        className={clsx(
          "sidebar-content-col-geometry sidebar-trailing-col-geometry sidebar-row-geometry theme-transition flex flex-col py-1.5 pb-3.5 text-left",
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
              triggerButtonVariant="sidebar-icon"
              items={[
                ...(onPin
                  ? [
                      {
                        label: pinMenuLabel,
                        icon: isPinned ? (
                          <PinSlashIcon className="size-4" />
                        ) : (
                          <PinIcon className="size-4" />
                        ),
                        onClick: onPin,
                        disabled: !canEdit || isPinLimitReached,
                      },
                    ]
                  : []),
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
                        icon: <EditIcon className="size-4" />,
                        onClick: onEditTitle,
                        disabled: !canEdit,
                      },
                    ]
                  : []),
                {
                  label: t`Remove`,
                  icon: <Trash className="size-4" />,
                  variant: "danger",
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
            {updatedAtDate && (
              <p className="text-xs text-theme-fg-secondary">
                <MessageTimestamp createdAt={updatedAtDate} />
              </p>
            )}
          </>
        )}
      </InteractiveContainer>
    );

    // A host without the web app's chat routes (the add-in pane) has no tab
    // for a modified click to open; there every activation selects in place,
    // and rendering no href keeps a middle click from navigating the webview
    // itself.
    if (disableRowLinks) {
      return (
        <InteractiveContainer
          useDiv={true}
          showFocusRing={false}
          onClick={() => onSelect()}
          className={`${sidebarRowLinkClassName} cursor-pointer`}
          aria-label={rowAriaLabel}
          aria-current={isActive ? "page" : undefined}
        >
          {rowBody}
        </InteractiveContainer>
      );
    }

    return (
      <a
        href={getChatUrl(session.id, session.assistantId)}
        onClick={(e) => {
          // Allow cmd/ctrl-click to open in new tab
          if (e.metaKey || e.ctrlKey) {
            return;
          }
          e.preventDefault();
          onSelect();
        }}
        className={sidebarRowLinkClassName}
        aria-label={rowAriaLabel}
        aria-current={isActive ? "page" : undefined}
      >
        {rowBody}
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
    onSessionPin,
    pinnedChatsCount = 0,
    pinnedChatsLimit = 5,
    onShowDetails,
    className,
    layout = "default",
    isLoading = false,
    hasMore = false,
    isLoadingMore = false,
    onLoadMore,
    showTimestamps = true,
    disableRowLinks = false,
  }) => {
    const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

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
            disableRowLinks={disableRowLinks}
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
            onPin={
              onSessionPin
                ? () => onSessionPin(session.id, !session.isPinned)
                : undefined
            }
            isPinned={session.isPinned}
            pinnedChatsCount={pinnedChatsCount}
            pinnedChatsLimit={pinnedChatsLimit}
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
    className="flex w-full min-w-0 flex-col gap-1"
  >
    {/* Container and row geometry mirror the real list exactly (inset comes
        from the host wrapper) so nothing shifts when loading finishes. */}
    {Array.from({ length: 5 }, (_, i) => (
      <div
        key={i}
        data-testid="chat-history-skeleton-item"
        className="sidebar-content-col-geometry sidebar-row-geometry sidebar-row-selected w-full py-1.5 pb-3.5 pr-1.5"
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
