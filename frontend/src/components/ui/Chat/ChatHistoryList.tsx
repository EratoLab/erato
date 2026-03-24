import { t } from "@lingui/core/macro";
import { Plural } from "@lingui/react/macro";
import clsx from "clsx";
import { memo, useEffect } from "react";

import { MessageTimestamp } from "@/components/ui";
import { useThemedIcon } from "@/hooks/ui";
import { getChatUrl } from "@/utils/chat/urlUtils";
import { createLogger } from "@/utils/debugLogger";

import { InteractiveContainer } from "../Container/InteractiveContainer";
import { DropdownMenu } from "../Controls/DropdownMenu";
import { LogOutIcon, ResolvedIcon, MultiplePagesIcon } from "../icons";

import type { ChatSession } from "@/types/chat";

const logger = createLogger("UI", "ChatHistoryList");
const sidebarRowStyle = {
  minHeight: "var(--theme-spacing-sidebar-row-height)",
  borderRadius: "var(--theme-radius-shell)",
} as const;
const activeSidebarRowStyle = {
  ...sidebarRowStyle,
  backgroundColor: "var(--theme-shell-sidebar-selected)",
} as const;
const sidebarListStyle = {
  padding:
    "calc(var(--theme-spacing-shell-padding-y) / 2) calc(var(--theme-spacing-shell-padding-x) / 2)",
} as const;
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

export interface ChatHistoryListProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onSessionArchive?: (sessionId: string) => void;
  onSessionEditTitle?: (sessionId: string) => void;
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
}

const ChatHistoryListItem = memo<{
  session: ChatSession;
  isActive: boolean;
  layout: "default" | "compact";
  onSelect: () => void;
  onArchive?: () => void;
  onEditTitle?: () => void;
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
    canEdit = true,
    onShowDetails,
    showTimestamps = true,
  }) => {
    const rowStyle = isActive ? activeSidebarRowStyle : sidebarRowStyle;

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
        aria-label={session.title || t`New Chat`}
        aria-current={isActive ? "page" : undefined}
      >
        <InteractiveContainer
          useDiv={true}
          showFocusRing={false}
          className={clsx(
            "theme-transition flex flex-col px-3 py-1.5 pb-3.5 pr-1.5 text-left",
            !isActive && "hover:bg-[var(--theme-shell-sidebar-hover)]",
            layout === "compact" ? "gap-0.5" : "gap-1",
          )}
          style={rowStyle}
          data-chat-id={session.id}
          data-ui="chat-history-item"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <ChatItemIcon />
              <span
                className="truncate font-medium"
                title={session.title || t`New Chat`}
              >
                {session.title || t`New Chat`}
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
    onShowDetails,
    className,
    layout = "default",
    isLoading = false,
    showTimestamps = true,
  }) => {
    const currentSession = sessions.find((s) => s.id === currentSessionId);
    const currentSessionTitle = currentSession?.title;

    useEffect(() => {
      if (typeof currentSessionTitle === "undefined") {
        return;
      }
      const pageTitle = t({ id: "branding.page_title_suffix" });
      document.title = `${currentSessionTitle} - ${pageTitle}`;
    }, [currentSessionTitle]);

    if (isLoading) {
      return <ChatHistoryListSkeleton layout={layout} />;
    }

    return (
      <div
        className={clsx(
          "flex w-full min-w-0 flex-col gap-1 overflow-y-auto",
          className,
        )}
        style={sidebarListStyle}
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
            canEdit={session.canEdit}
            onShowDetails={
              onShowDetails ? () => onShowDetails(session.id) : undefined
            }
          />
        ))}
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
    className="flex w-full min-w-0 flex-col gap-1 overflow-y-auto bg-[var(--theme-shell-sidebar)]"
    style={sidebarListStyle}
  >
    {Array.from({ length: 5 }, (_, i) => (
      <div
        key={i}
        data-testid="chat-history-skeleton-item"
        className="w-full px-4 py-3"
        style={activeSidebarRowStyle}
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
