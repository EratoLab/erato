import React from "react";
import clsx from "clsx";
import { ChatSession } from "../../types/chat";
import { format } from "date-fns";

export interface ChatHistoryListProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete?: (sessionId: string) => void;
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
}

export const ChatHistoryList: React.FC<ChatHistoryListProps> = ({
  sessions,
  currentSessionId,
  onSessionSelect,
  onSessionDelete,
  className,
  layout = "default",
  showTimestamps = true,
}) => {
  return (
    <div className={clsx(
      "flex flex-col gap-1 overflow-y-auto",
      "bg-theme-bg-secondary",
      className
    )}>
      {sessions.map((session) => (
        <button
          key={session.id}
          onClick={() => onSessionSelect(session.id)}
          className={clsx(
            "flex flex-col text-left px-4 py-3 rounded-lg transition-colors",
            "hover:bg-theme-bg-accent",
            "text-theme-fg-primary",
            currentSessionId === session.id && "bg-theme-bg-accent",
            layout === "compact" ? "gap-0.5" : "gap-2"
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium truncate">{session.title}</span>
            {onSessionDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSessionDelete(session.id);
                }}
                className="p-1 rounded-full hover:bg-theme-bg-hover"
                aria-label="Delete chat"
              >
                <svg
                  className="w-4 h-4 text-theme-fg-secondary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
          {layout !== "compact" && session.metadata?.lastMessage && (
            <p className="text-sm text-theme-fg-secondary truncate">
              {session.metadata.lastMessage.content}
            </p>
          )}
          {showTimestamps && (
            <span className="text-xs text-theme-fg-tertiary">
              {format(session.updatedAt, "MMM d, yyyy")}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}; 