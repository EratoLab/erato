import React, { memo, useRef, useState } from "react";
import clsx from "clsx";
import { ErrorBoundary } from "react-error-boundary";
import useResizeObserver from "@react-hook/resize-observer";
import { ChatHistoryList, ChatHistoryListSkeleton } from "./ChatHistoryList";
import { useChatHistory } from "../containers/ChatHistoryProvider";
import { SidebarToggleIcon, EditIcon } from "./icons";
import { Button } from "./Button";

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
  onToggleCollapse?: () => void;
  showTitle?: boolean;
}

const ChatHistoryHeader = memo<{
  onNewChat?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  showTitle?: boolean;
}>(({ onNewChat, collapsed, onToggleCollapse, showTitle = false }) => (
  <div
    className={clsx(
      "grid h-14 border-b border-theme-border",
      // Adjust grid to ensure right alignment of new chat button
      collapsed ? "grid-cols-[48px]" : "grid-cols-[48px_1fr_48px] items-center",
    )}
  >
    <div className="flex justify-center">
      <Button
        onClick={onToggleCollapse}
        variant="sidebar-icon"
        icon={<SidebarToggleIcon />}
        className={!collapsed ? "rotate-180" : ""}
        aria-label={collapsed ? "expand sidebar" : "collapse sidebar"}
        aria-expanded={collapsed ? "false" : "true"}
      />
    </div>
    {!collapsed && (
      <>
        <div>
          {" "}
          {/* Middle column always present */}
          {showTitle && (
            <h2 className="font-semibold text-theme-fg-primary">
              Chat History
            </h2>
          )}
        </div>
        <div className="flex justify-end">
          <Button
            onClick={onNewChat}
            variant="sidebar-icon"
            icon={<EditIcon />}
            aria-label="New Chat"
          />
        </div>
      </>
    )}
  </div>
));

ChatHistoryHeader.displayName = "ChatHistoryHeader";

const ErrorDisplay = ({ error }: { error: Error }) => (
  <div className="flex flex-col items-center justify-center p-4 text-theme-fg-error">
    <p className="font-medium">Something went wrong</p>
    <p className="text-sm">{error.message}</p>
  </div>
);

export const ChatHistorySidebar = memo<ChatHistorySidebarProps>(
  ({
    className,
    collapsed = false,
    minWidth = 280,
    onNewChat,
    onToggleCollapse,
    showTitle = false,
  }) => {
    const ref = useRef<HTMLElement>(null);
    const [width, setWidth] = useState(minWidth);

    const {
      sessions,
      currentSessionId,
      switchSession,
      deleteSession,
      isLoading,
      error,
    } = useChatHistory();

    useResizeObserver(ref, (entry) => {
      setWidth(entry.contentRect.width);
    });

    const sidebarWidth = collapsed ? 56 : Math.max(width, minWidth);

    return (
      <ErrorBoundary FallbackComponent={ErrorDisplay}>
        <aside
          ref={ref}
          style={{ width: sidebarWidth }}
          className={clsx(
            "flex flex-col h-full border-r border-theme-border",
            "bg-theme-bg-secondary transition-all duration-200",
            collapsed && "overflow-hidden",
            className,
          )}
        >
          <ChatHistoryHeader
            onNewChat={onNewChat}
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
            showTitle={showTitle}
          />
          {!collapsed && (
            <>
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
            </>
          )}
        </aside>
      </ErrorBoundary>
    );
  },
);

ChatHistorySidebar.displayName = "ChatHistorySidebar";
