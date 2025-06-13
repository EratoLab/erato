import { t } from "@lingui/core/macro";
import { Plural } from "@lingui/react/macro";
import clsx from "clsx";
import { memo } from "react";

import { MessageTimestamp } from "@/components/ui";

import { InteractiveContainer } from "../Container/InteractiveContainer";
import { DropdownMenu } from "../Controls/DropdownMenu";
import { LogOutIcon } from "../icons";

import type { ChatSession } from "@/types/chat";

export interface ChatHistoryListProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onSessionArchive?: (sessionId: string) => void;
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
  onShowDetails?: () => void;
  showTimestamps?: boolean;
}>(
  ({
    session,
    isActive,
    layout,
    onSelect,
    onArchive,
    onShowDetails,
    showTimestamps = true,
  }) => (
    <a
      href={`/chat/${session.id}`}
      onClick={(e) => {
        // Allow cmd/ctrl-click to open in new tab
        if (e.metaKey || e.ctrlKey) {
          return;
        }
        // Prevent default navigation for normal clicks
        e.preventDefault();
        onSelect();
      }}
      className="block"
      aria-label={session.title || t`New Chat`}
    >
      <InteractiveContainer
        useDiv={true}
        className={clsx(
          "flex flex-col rounded-lg px-3 py-1.5 pr-1.5 text-left",
          isActive && "bg-theme-bg-selected",
          "hover:bg-theme-bg-hover",
          layout === "compact" ? "gap-0.5" : "gap-1",
        )}
        data-chat-id={session.id}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">
            {session.title || t`New Chat`}
          </span>
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- div exists to prevent bubbling */}
          <div
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <DropdownMenu
              items={[
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
        {layout !== "compact" && (
          <>
            <p
              className={clsx(
                "truncate text-xs",
                session.metadata?.fileCount == 0
                  ? "text-theme-fg-muted"
                  : "text-theme-fg-secondary",
              )}
            >
              <Plural
                value={session.metadata?.fileCount ?? 0}
                _0="No files"
                one="# file"
                other="# files"
              />
            </p>
            {showTimestamps && session.updatedAt && (
              <p className="text-xs text-theme-fg-secondary">
                <MessageTimestamp createdAt={new Date(session.updatedAt)} />
              </p>
            )}
          </>
        )}
      </InteractiveContainer>
    </a>
  ),
);

// eslint-disable-next-line lingui/no-unlocalized-strings
ChatHistoryListItem.displayName = "ChatHistoryListItem";

export const ChatHistoryList = memo<ChatHistoryListProps>(
  ({
    sessions,
    currentSessionId,
    onSessionSelect,
    onSessionArchive,
    onShowDetails,
    className,
    layout = "default",
    isLoading = false,
    showTimestamps = true,
  }) => {
    if (isLoading) {
      return <ChatHistoryListSkeleton layout={layout} />;
    }

    return (
      <div
        className={clsx(
          "flex flex-col gap-1 overflow-y-auto p-2",
          "w-full min-w-[280px] max-w-md",
          className,
        )}
      >
        {sessions.map((session) => (
          <ChatHistoryListItem
            key={session.id}
            session={session}
            isActive={currentSessionId === session.id}
            layout={layout}
            showTimestamps={showTimestamps}
            onSelect={() => {
              console.log(`[CHAT_FLOW] Session item click: ${session.id}`);
              onSessionSelect(session.id);
            }}
            onArchive={
              onSessionArchive ? () => onSessionArchive(session.id) : undefined
            }
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
    className="flex w-full min-w-[280px] max-w-md flex-col gap-1 overflow-y-auto bg-theme-bg-secondary p-2"
  >
    {Array.from({ length: 5 }, (_, i) => (
      <div
        key={i}
        data-testid="chat-history-skeleton-item"
        className="w-full rounded-lg bg-theme-bg-primary px-4 py-3"
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
