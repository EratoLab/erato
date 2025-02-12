import React, { memo, useRef, useState } from "react";
import clsx from "clsx";
import { ErrorBoundary } from "react-error-boundary";
import useResizeObserver from "@react-hook/resize-observer";
import { ChatHistoryList, ChatHistoryListSkeleton } from "./ChatHistoryList";
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

const ChatHistoryHeader = memo<{ onNewChat?: () => void }>(({ onNewChat }) => (
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
));

ChatHistoryHeader.displayName = "ChatHistoryHeader";

const ErrorDisplay = ({ error }: { error: Error }) => (
  <div className="flex flex-col items-center justify-center p-4 text-theme-fg-error">
    <p className="font-medium">Something went wrong</p>
    <p className="text-sm">{error.message}</p>
  </div>
);

export const ChatHistorySidebar = memo<ChatHistorySidebarProps>(({
  className,
  collapsed = false,
  minWidth = 280,
  onNewChat,
}) => {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(minWidth);
  
  const {
    sessions,
    currentSessionId,
    switchSession,
    deleteSession,
    isLoading,
    error
  } = useChatHistory();

  useResizeObserver(ref, (entry) => {
    setWidth(entry.contentRect.width);
  });
  
  const sidebarWidth = collapsed ? 0 : Math.max(width, minWidth);

  return (
    <ErrorBoundary FallbackComponent={ErrorDisplay}>
      <aside
        ref={ref}
        style={{ width: sidebarWidth }}
        className={clsx(
          "flex flex-col h-full border-r border-theme-border",
          "bg-theme-bg-secondary transition-all duration-200",
          collapsed && "overflow-hidden",
          className
        )}
      >
        <ChatHistoryHeader onNewChat={onNewChat} />
        
        {error ? (
          <ErrorDisplay error={error} />
        ) : isLoading ? (
          <ChatHistoryListSkeleton />
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
    </ErrorBoundary>
  );
});

ChatHistorySidebar.displayName = "ChatHistorySidebar";
