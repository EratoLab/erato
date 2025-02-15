import React, { memo, useRef, useState } from "react";
import clsx from "clsx";
import { ErrorBoundary } from "react-error-boundary";
import useResizeObserver from "@react-hook/resize-observer";
import { ChatHistoryList, ChatHistoryListSkeleton } from "./ChatHistoryList";
import { SidebarToggleIcon, EditIcon } from "./icons";
import { Button } from "./Button";
import { UserProfileDropdown } from "./UserProfileDropdown";
import type { ChatSession, UserProfile } from "../../types/chat";

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
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  isLoading: boolean;
  error?: Error;
}

const ChatHistoryHeader = memo<{
  onNewChat?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  showTitle?: boolean;
}>(({ onNewChat, collapsed, onToggleCollapse, showTitle = false }) => (
  <div
    className={clsx(
      "flex h-14 border-b border-theme-border",
      // Replace grid with flex layout for better control
      collapsed ? "justify-center" : "justify-between",
    )}
  >
    <div className="w-12 flex justify-center">
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
        <div className="flex-1 flex items-center">
          {showTitle && (
            <h2 className="font-semibold text-theme-fg-primary">
              Chat History
            </h2>
          )}
        </div>
        <div className="w-12 flex justify-center">
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

const ChatHistoryFooter = memo<{
  userProfile?: UserProfile;
  onSignOut: () => void;
}>(({ userProfile, onSignOut }) => (
  <div className="p-2 border-t border-theme-border">
    <UserProfileDropdown
      userProfile={userProfile}
      onSignOut={onSignOut}
      className="w-full flex items-center justify-start"
    />
  </div>
));

ChatHistoryFooter.displayName = "ChatHistoryFooter";

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
    sessions,
    currentSessionId,
    onSessionSelect,
    onSessionDelete,
    isLoading,
    error,
  }) => {
    const ref = useRef<HTMLElement>(null);
    const [width, setWidth] = useState(minWidth);

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
              <div className="flex-1 flex flex-col min-h-0">
                {error ? (
                  <ErrorDisplay error={error} />
                ) : isLoading ? (
                  <ChatHistoryListSkeleton />
                ) : (
                  <ChatHistoryList
                    sessions={sessions}
                    currentSessionId={currentSessionId}
                    onSessionSelect={onSessionSelect}
                    onSessionDelete={onSessionDelete}
                    className="flex-1 p-2"
                  />
                )}
              </div>
              <ChatHistoryFooter
                userProfile={sessions[0]?.metadata?.userProfile}
                onSignOut={() => {
                  // TODO: Implement sign out logic
                  console.log("Sign out clicked");
                }}
              />
            </>
          )}
        </aside>
      </ErrorBoundary>
    );
  },
);

ChatHistorySidebar.displayName = "ChatHistorySidebar";
