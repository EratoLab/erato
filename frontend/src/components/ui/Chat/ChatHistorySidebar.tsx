import useResizeObserver from "@react-hook/resize-observer";
import clsx from "clsx";
import React, { memo, useRef, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { ChatHistoryList, ChatHistoryListSkeleton } from "./ChatHistoryList";
import { Button } from "../Controls/Button";
import { UserProfileDropdown } from "../Controls/UserProfileDropdown";
import { SidebarToggleIcon, EditIcon } from "../icons";

import type { ChatSession, UserProfile } from "@/types/chat";

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
  userProfile?: UserProfile;
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
    <div className="flex w-12 justify-center">
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
        <div className="flex flex-1 items-center">
          {showTitle && (
            <h2 className="font-semibold text-theme-fg-primary">
              Chat History
            </h2>
          )}
        </div>
        <div className="flex w-12 justify-center">
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
  <div className="border-t border-theme-border p-2">
    <UserProfileDropdown
      userProfile={userProfile}
      onSignOut={onSignOut}
      className="flex w-full items-center justify-start"
      showThemeToggle={true}
    />
  </div>
));

ChatHistoryFooter.displayName = "ChatHistoryFooter";

const ErrorDisplay = ({ error }: { error: Error }) => (
  <div className="flex flex-col items-center justify-center p-4 text-theme-error-fg">
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
    userProfile,
  }) => {
    const ref = useRef<HTMLElement>(null);
    const [width, setWidth] = useState(minWidth);

    useResizeObserver(ref, (entry) => {
      setWidth(entry.contentRect.width);
    });

    const sidebarWidth = collapsed ? 56 : Math.max(width, minWidth);

    const handleSignOut = () => {
      console.log("ChatHistorySidebar handleSignOut called");
      try {
        const signOutUrl = "/oauth2/sign_out";
        console.log("Attempting to redirect to:", signOutUrl);
        window.location.href = signOutUrl;

        setTimeout(() => {
          console.log("Fallback timeout triggered");
          const fullUrl = `${process.env.NEXT_PUBLIC_API_ROOT_URL}${signOutUrl}`;
          console.log("Attempting fallback redirect to:", fullUrl);
          window.location.href = fullUrl;
        }, 1000);
      } catch (error) {
        console.error("Failed to sign out:", error);
      }
    };

    return (
      <ErrorBoundary FallbackComponent={ErrorDisplay}>
        <aside
          ref={ref}
          style={{ width: sidebarWidth }}
          className={clsx(
            "flex h-full flex-col border-r border-theme-border",
            "theme-transition bg-theme-bg-sidebar",
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
              <div className="flex min-h-0 flex-1 flex-col">
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
                userProfile={userProfile}
                onSignOut={handleSignOut}
              />
            </>
          )}
        </aside>
      </ErrorBoundary>
    );
  },
);

ChatHistorySidebar.displayName = "ChatHistorySidebar";
