import { plural, t } from "@lingui/core/macro";
import clsx from "clsx";
import { memo, useEffect, useMemo, useRef } from "react";

import { MessageTimestamp } from "@/components/ui";
import { useChatHistoryStore } from "@/hooks/chat/useChatHistory";
import { useChatRowStatus } from "@/hooks/chat/useChatRowStatus";
import { useThemedIcon } from "@/hooks/ui";
import { delegatedRunOrigin } from "@/utils/chat/delegatedRunOrigin";
import {
  DELEGATION_PROVENANCE_KIND,
  resolveRecentChatTitle,
} from "@/utils/chat/recentChatSession";
import { getChatUrl } from "@/utils/chat/urlUtils";
import { chatAttentionStatusLabel } from "@/utils/chatHistoryGrouping";
import { createLogger } from "@/utils/debugLogger";

import { ChatAttentionStatusDot } from "./ChatAttentionStatusDot";
import {
  ArchivedChatPill,
  archivedChatLabel,
  buildArchiveMenuItems,
} from "./chatArchiveActions";
import { CHAT_HISTORY_ROW_MENU_ID } from "./chatHistoryRowMenuIds";
import { CHAT_HISTORY_ROW_TEST_ID } from "./chatHistoryRowTestIds";
import { InteractiveContainer } from "../Container/InteractiveContainer";
import { DropdownMenu } from "../Controls/DropdownMenu";
import { Row } from "../Controls/Row";
import { SpinnerIcon } from "../Feedback/SpinnerIcon";
import {
  EditIcon,
  ResolvedIcon,
  MultiplePagesIcon,
  PinIcon,
  PinSlashIcon,
  ShareIcon,
} from "../icons";

import type { DropdownMenuItem } from "../Controls/DropdownMenu";
import type { ChatSession } from "@/types/chat";
import type { DelegatedRunOrigin } from "@/utils/chat/delegatedRunOrigin";
import type { ChatAttentionStatus } from "@/utils/chatHistoryGrouping";
import type { ReactNode } from "react";

const logger = createLogger("UI", "ChatHistoryList");
// Inset ring: the outside-drawn variant gets clipped by the sidebar
// scrollport whenever the themeable row inset is below the ring width.
const sidebarRowLinkClassName =
  "focus-ring-inset block rounded-[var(--theme-radius-shell)]";
// Authored once: a list that defaulted it separately could neutralise the pin
// gate without touching the gate.
export const DEFAULT_PINNED_CHATS_LIMIT = 5;

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

/**
 * Render `badges` and `subline` rather than their ingredients; a kit that
 * rebuilds either loses row rules added later.
 */
export interface ChatHistoryRowPresentation {
  title: string;
  status: ChatAttentionStatus | null;
  statusLabel: string | null;
  archived: boolean;
  archivedLabel: string | null;
  runOrigin: DelegatedRunOrigin | null;
  badges: ReactNode;
  subline: ReactNode;
  ariaLabel: string;
}

// Takes the two resolved values rather than reading them, so the hook below
// and `useChatHistoryRow` can share it while each subscribes only once.
const rowPresentation = (
  session: ChatSession,
  title: string,
  status: ChatAttentionStatus | null,
): ChatHistoryRowPresentation => {
  const statusLabel = status ? chatAttentionStatusLabel(status) : null;
  const archived = session.archivedAt != null;
  const archivedLabel = archived ? archivedChatLabel() : null;
  const runOrigin = delegatedRunOrigin(session);

  return {
    title,
    status,
    statusLabel,
    archived,
    archivedLabel,
    runOrigin,
    badges: (
      <>
        {status && <ChatAttentionStatusDot status={status} />}
        {archivedLabel && <ArchivedChatPill label={archivedLabel} />}
      </>
    ),
    subline: runOrigin ? (
      <p
        className="truncate text-xs text-theme-fg-muted"
        title={runOrigin.label}
        data-testid={CHAT_HISTORY_ROW_TEST_ID.runOrigin}
      >
        {runOrigin.label}
      </p>
    ) : null,
    ariaLabel: [title, archivedLabel, runOrigin?.label, statusLabel]
      .filter(Boolean)
      .join(", "),
  };
};

export const useChatHistoryRowPresentation = (
  session: ChatSession,
): ChatHistoryRowPresentation =>
  rowPresentation(
    session,
    useRowTitle(session),
    useChatRowStatus(session.id, session),
  );

export interface ChatHistoryRowMenuHandlers {
  pinnedChatsCount: number;
  pinnedChatsLimit: number;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onEditTitle?: () => void;
  onShare?: () => void;
  onPin?: () => void;
}

export interface ChatHistoryRowMenuOptions extends ChatHistoryRowMenuHandlers {
  session: ChatSession;
}

/** What the gates read, for a row that is not a `ChatSession`. */
export interface ChatHistoryRowMenuState {
  archived: boolean;
  isPinned: boolean;
  canEdit: boolean;
  isRun: boolean;
  status: ChatAttentionStatus | null;
}

/**
 * The row's dropdown items, already gated. A caller renders the array as it
 * comes; nothing it leaves out can drop a rule.
 *
 * Host-only, withheld from the kit surface by name in the generator: building
 * the state by hand loses the run and pending-confirmation gates.
 */
export const buildChatHistoryRowMenuItems = (
  { archived, isPinned, canEdit, isRun, status }: ChatHistoryRowMenuState,
  {
    pinnedChatsCount,
    pinnedChatsLimit,
    onArchive,
    onUnarchive,
    onEditTitle,
    onShare,
    onPin,
  }: ChatHistoryRowMenuHandlers,
): DropdownMenuItem[] => {
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

  return [
    ...(onPin && !archived
      ? [
          {
            id: CHAT_HISTORY_ROW_MENU_ID.pin,
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
    ...(onShare && !archived
      ? [
          {
            id: CHAT_HISTORY_ROW_MENU_ID.share,
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
            id: CHAT_HISTORY_ROW_MENU_ID.rename,
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
    // Runs get neither: archiving cannot cancel a live generation or free a
    // parked approval, and cleanup re-archives unadopted runs.
    ...(isRun
      ? []
      : buildArchiveMenuItems({
          archived,
          status,
          onArchive,
          onUnarchive,
        })),
  ];
};

export const chatHistoryRowMenuOptions = (
  {
    onSessionArchive,
    onSessionUnarchive,
    onSessionEditTitle,
    onSessionShare,
    onSessionPin,
    pinnedChatsCount = 0,
    pinnedChatsLimit = DEFAULT_PINNED_CHATS_LIMIT,
  }: ChatHistoryListProps,
  session: ChatSession,
): ChatHistoryRowMenuOptions => ({
  session,
  pinnedChatsCount,
  pinnedChatsLimit,
  onArchive: onSessionArchive ? () => onSessionArchive(session.id) : undefined,
  onUnarchive: onSessionUnarchive
    ? () => onSessionUnarchive(session.id)
    : undefined,
  onEditTitle: onSessionEditTitle
    ? () => onSessionEditTitle(session.id)
    : undefined,
  onShare: onSessionShare ? () => onSessionShare(session.id) : undefined,
  onPin: onSessionPin
    ? () => onSessionPin(session.id, !(session.isPinned ?? false))
    : undefined,
});

const rowMenuState = (
  session: ChatSession,
  status: ChatAttentionStatus | null,
): ChatHistoryRowMenuState => ({
  archived: session.archivedAt != null,
  isPinned: session.isPinned ?? false,
  canEdit: session.canEdit ?? true,
  // Keyed on provenance, not on the origin label: `delegatedRunOrigin` is
  // null for a run that records no origin at all, and that is still a run.
  isRun: session.provenanceKind === DELEGATION_PROVENANCE_KIND,
  status,
});

export const useChatHistoryRowMenuItems = ({
  session,
  ...handlers
}: ChatHistoryRowMenuOptions): DropdownMenuItem[] => {
  const status = useChatRowStatus(session.id, session);

  return buildChatHistoryRowMenuItems(rowMenuState(session, status), handlers);
};

export interface ChatHistoryRow extends ChatHistoryRowPresentation {
  menuItems: DropdownMenuItem[];
}

/**
 * A row that calls both hooks above subscribes to the status stores twice.
 */
export const useChatHistoryRow = (
  props: ChatHistoryListProps,
  session: ChatSession,
): ChatHistoryRow => {
  const title = useRowTitle(session);
  const status = useChatRowStatus(session.id, session);

  return {
    ...rowPresentation(session, title, status),
    menuItems: buildChatHistoryRowMenuItems(
      rowMenuState(session, status),
      chatHistoryRowMenuOptions(props, session),
    ),
  };
};

export interface ChatHistoryListProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onSessionArchive?: (sessionId: string) => void;
  onSessionUnarchive?: (sessionId: string) => void;
  onSessionEditTitle?: (sessionId: string) => void;
  onSessionShare?: (sessionId: string) => void;
  onSessionPin?: (sessionId: string, isPinned: boolean) => void;
  pinnedChatsCount?: number;
  pinnedChatsLimit?: number;
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

// The placeholder must stay `count`: component-kit catalogs merge last and
// format this id with {count, plural, …}.
const getFileCountLabel = (count: number) =>
  t({
    id: "chat.history.files.count",
    message: plural(count, { 0: "No files", one: "# file", other: "# files" }),
  });

const ChatHistoryListItem = memo<{
  listProps: ChatHistoryListProps;
  session: ChatSession;
  isActive: boolean;
  layout: "default" | "compact";
  onSelect: () => void;
  showTimestamps?: boolean;
  disableRowLinks?: boolean;
}>(
  ({
    listProps,
    session,
    isActive,
    layout,
    onSelect,
    showTimestamps = true,
    disableRowLinks = false,
  }) => {
    const {
      title: rowTitle,
      badges,
      subline,
      ariaLabel: rowAriaLabel,
      menuItems,
    } = useChatHistoryRow(listProps, session);
    // A stable Date instance: an inline `new Date(...)` would defeat
    // MessageTimestamp's shallow memo on every list render.
    const updatedAtDate = useMemo(
      () => (session.updatedAt ? new Date(session.updatedAt) : null),
      [session.updatedAt],
    );
    const fileCountLabel = getFileCountLabel(session.metadata?.fileCount ?? 0);
    const rowBody = (
      // Row owns the row geometry, the selected fill and the hover tint; the
      // column flow stays here because the sidebar variant sets no axis.
      <Row
        variant="sidebar"
        as="div"
        selected={isActive}
        className={clsx(
          "sidebar-content-col-geometry sidebar-trailing-col-geometry flex-col py-1.5 pb-3.5",
          layout === "compact" ? "gap-0.5" : "gap-1",
        )}
        // Spread, because the attribute NAME is the pinned part.
        {...{ [CHAT_HISTORY_ROW_TEST_ID.row]: session.id }}
        data-ui="chat-history-item"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {badges}
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
              items={menuItems}
            />
          </div>
        </div>
        {subline}
        {layout !== "compact" && showTimestamps && (
          <>
            <p
              className={clsx(
                "truncate text-xs",
                session.metadata?.fileCount == 0
                  ? "text-theme-fg-muted"
                  : "text-theme-fg-secondary",
              )}
              title={fileCountLabel}
            >
              {fileCountLabel}
            </p>
            {updatedAtDate && (
              <p className="text-xs text-theme-fg-secondary">
                <MessageTimestamp createdAt={updatedAtDate} />
              </p>
            )}
          </>
        )}
      </Row>
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

export const ChatHistoryList = memo<ChatHistoryListProps>((props) => {
  const {
    sessions,
    currentSessionId,
    onSessionSelect,
    className,
    layout = "default",
    isLoading = false,
    hasMore = false,
    isLoadingMore = false,
    onLoadMore,
    showTimestamps = true,
    disableRowLinks = false,
  } = props;
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
          isActive={currentSessionId === session.id}
          layout={layout}
          showTimestamps={showTimestamps}
          disableRowLinks={disableRowLinks}
          onSelect={() => {
            logger.log(`Session item click: ${session.id}`);
            onSessionSelect(session.id);
          }}
          listProps={props}
          session={session}
        />
      ))}
      {hasMore && (
        <div
          ref={loadMoreSentinelRef}
          className="flex justify-center py-2"
          data-ui="chat-history-load-more-sentinel"
          aria-label={t({
            id: "chat.history.loading_more",
            message: "Loading...",
          })}
        >
          {isLoadingMore && <SpinnerIcon size="md" aria-hidden />}
        </div>
      )}
    </div>
  );
});

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
        from the host wrapper) so nothing shifts when loading finishes. The
        mirror is the same component, so it cannot drift; `flex-col` is the
        site's, as on the real row, because Row sets no axis. */}
    {Array.from({ length: 5 }, (_, i) => (
      <Row
        key={i}
        variant="sidebar"
        as="div"
        interactive={false}
        selected
        data-testid="chat-history-skeleton-item"
        className="sidebar-content-col-geometry flex-col py-1.5 pb-3.5 pr-1.5"
      >
        <div className="flex w-full items-center justify-between gap-2">
          <div className="h-5 w-2/3 animate-pulse rounded bg-theme-bg-accent" />
          <div className="size-8 shrink-0 animate-pulse rounded bg-theme-bg-accent" />
        </div>
        {layout !== "compact" && (
          <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-theme-bg-accent" />
        )}
      </Row>
    ))}
  </div>
);
