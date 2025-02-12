import React from "react";
import clsx from "clsx";
import { ChatHistoryList } from "./ChatHistoryList";
import { useChatHistory } from "../containers/ChatHistoryProvider";

export interface ChatHistorySidebarProps {
  className?: string;
  /**
   * Whether the sidebar is collapsed
   * @default false
   */
  collapsed?: boolean;
  /**
   * Minimum width of the sidebar when expanded
   * @default 280
   */
  minWidth?: number;
  onNewChat?: () => void;
}

export const ChatHistorySidebar: React.FC<ChatHistorySidebarProps> = ({
  className,
  collapsed = false,
  minWidth = 280,
  onNewChat,
}) => {
  const {
    sessions,
    currentSessionId,
    switchSession,
    deleteSession,
    isLoading,
  } = useChatHistory();

  return (
    <aside
      className={clsx(
        "flex flex-col h-full border-r border-theme-border",
        "bg-theme-bg-secondary transition-all duration-200",
        collapsed ? "w-0 overflow-hidden" : `w-[${minWidth}px]`,
        className
      )}
    >
      <div className="flex items-center justify-between p-4 border-b border-theme-border">
        <h2 className="font-semibold text-theme-fg-primary">Chat History</h2>
        <button
          onClick={onNewChat}
          className={clsx(
            "p-2 rounded-lg text-sm font-medium",
            "bg-theme-bg-accent hover:bg-theme-bg-hover",
            "text-theme-fg-primary transition-colors"
          )}
        >
          New Chat
        </button>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-theme-fg-secondary">Loading chats...</div>
        </div>
      ) : (
        <ChatHistoryList
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSessionSelect={switchSession}
          onSessionDelete={deleteSession}
          className="flex-1 p-2"
        />
      )}
    </aside>
  );
}; 