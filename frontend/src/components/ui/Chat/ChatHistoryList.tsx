import clsx from "clsx";
import React, { memo } from "react";

import { InteractiveContainer } from "../Container/InteractiveContainer";
import { DropdownMenu } from "../Controls/DropdownMenu";
import { Info, Trash } from "../icons";

import type { ChatSession } from "@/types/chat";

export interface ChatHistoryListProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete?: (sessionId: string) => void;
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
  onDelete?: () => void;
  onShowDetails?: () => void;
}>(({ session, isActive, layout, onSelect, onDelete, onShowDetails }) => (
  <InteractiveContainer
    onClick={onSelect}
    useDiv={true}
    className={clsx(
      "flex flex-col text-left px-4 py-3 rounded-lg",
      isActive && "bg-theme-bg-selected",
      "hover:bg-theme-bg-hover",
      layout === "compact" ? "gap-0.5" : "gap-2",
    )}
  >
    <div className="flex items-center justify-between gap-2">
      <span className="font-medium truncate">{session.title}</span>
      <DropdownMenu
        items={[
          {
            label: "Show Details",
            icon: <Info className="w-4 h-4" />,
            onClick: onShowDetails ?? (() => {}),
          },
          {
            label: "Delete",
            icon: <Trash className="w-4 h-4" />,
            onClick: onDelete ?? (() => {}),
            variant: "danger",
          },
        ]}
      />
    </div>
    {layout !== "compact" && session.metadata?.lastMessage && (
      <p className="text-sm text-theme-fg-secondary truncate">
        {session.metadata.lastMessage.content}
      </p>
    )}
  </InteractiveContainer>
));

ChatHistoryListItem.displayName = "ChatHistoryListItem";

export const ChatHistoryList = memo<ChatHistoryListProps>(
  ({
    sessions,
    currentSessionId,
    onSessionSelect,
    onSessionDelete,
    onShowDetails,
    className,
    layout = "default",
    isLoading = false,
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
            onSelect={() => onSessionSelect(session.id)}
            onDelete={
              onSessionDelete ? () => onSessionDelete(session.id) : undefined
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

ChatHistoryList.displayName = "ChatHistoryList";

export const ChatHistoryListSkeleton = ({
  layout = "default",
}: {
  layout?: "default" | "compact";
}) => (
  <div
    data-testid="chat-history-skeleton"
    className="flex flex-col gap-1 overflow-y-auto bg-theme-bg-secondary w-full min-w-[280px] max-w-md p-2"
  >
    {Array.from({ length: 5 }, (_, i) => (
      <div
        key={i}
        data-testid="chat-history-skeleton-item"
        className="px-4 py-3 rounded-lg w-full bg-theme-bg-primary"
      >
        <div className="flex items-center justify-between gap-2 w-full">
          <div className="h-5 bg-theme-bg-accent rounded w-2/3 animate-pulse" />
          <div className="h-8 w-8 bg-theme-bg-accent rounded animate-pulse shrink-0" />
        </div>
        {layout !== "compact" && (
          <div className="h-4 bg-theme-bg-accent rounded w-4/5 mt-2 animate-pulse" />
        )}
      </div>
    ))}
  </div>
);
