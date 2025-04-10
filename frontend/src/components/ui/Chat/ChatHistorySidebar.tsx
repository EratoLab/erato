import clsx from "clsx";
import React, { memo, useRef, useState, useEffect } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { ChatHistoryList, ChatHistoryListSkeleton } from "./ChatHistoryList";
import { Button } from "../Controls/Button";
import { UserProfileThemeDropdown } from "../Controls/UserProfileThemeDropdown";
import { SidebarToggleIcon, EditIcon } from "../icons";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "@/types/chat";

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
  /**
   * Whether to show timestamps for chats
   * @default true
   */
  showTimestamps?: boolean;
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
  collapsed: boolean;
  onToggleCollapse?: () => void;
  showTitle?: boolean;
}>(({ onNewChat, collapsed, onToggleCollapse, showTitle }) => (
  <div className="flex border-b border-theme-border p-2">
    {/* Only show the toggle button when not collapsed */}
    {!collapsed && (
      <div className="flex w-12 justify-center">
        <Button
          onClick={onToggleCollapse}
          variant="sidebar-icon"
          icon={<SidebarToggleIcon />}
          className="rotate-180"
          aria-label="collapse sidebar"
          aria-expanded="true"
        />
      </div>
    )}
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
            onClick={() => {
              console.log("[CHAT_FLOW] New chat button clicked in sidebar");
              if (onNewChat) void onNewChat();
            }}
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
    <UserProfileThemeDropdown
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
    showTimestamps = true,
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

    // Only use ResizeObserver in the browser
    const isBrowser = typeof window !== "undefined";

    useEffect(() => {
      if (isBrowser && ref.current) {
        // Create observer manually to avoid SSR issues
        const resizeObserver = new ResizeObserver((entries) => {
          if (entries.length > 0) {
            setWidth(entries[0].contentRect.width);
          }
        });

        resizeObserver.observe(ref.current);

        // Clean up
        return () => {
          resizeObserver.disconnect();
        };
      }
    }, [isBrowser, ref]);

    // When not collapsed, set the sidebar width
    // When collapsed, we'll hide it completely with CSS
    const sidebarWidth = collapsed ? 0 : Math.max(width, minWidth);

    const handleSignOut = () => {
      if (!isBrowser) return;

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
        <div className="relative h-full">
          {/* Absolutely positioned toggle button when collapsed */}
          {collapsed && (
            <div className="absolute left-4 top-4 z-30">
              <Button
                onClick={onToggleCollapse}
                variant="sidebar-icon"
                icon={<SidebarToggleIcon />}
                className="border border-theme-border bg-theme-bg-sidebar shadow-md"
                aria-label="expand sidebar"
                aria-expanded="false"
              />
            </div>
          )}

          <aside
            ref={ref}
            style={{ width: sidebarWidth }}
            className={clsx(
              "flex h-full flex-col border-r border-theme-border",
              "theme-transition bg-theme-bg-sidebar",
              collapsed ? "invisible w-0 opacity-0" : "visible opacity-100",
              className,
            )}
          >
            <ChatHistoryHeader
              onNewChat={onNewChat}
              collapsed={collapsed}
              onToggleCollapse={onToggleCollapse}
              showTitle={showTitle}
            />
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
                  showTimestamps={showTimestamps}
                  className="flex-1 p-2"
                />
              )}
            </div>
            <ChatHistoryFooter
              userProfile={userProfile}
              onSignOut={handleSignOut}
            />
          </aside>
        </div>
      </ErrorBoundary>
    );
  },
);

ChatHistorySidebar.displayName = "ChatHistorySidebar";
