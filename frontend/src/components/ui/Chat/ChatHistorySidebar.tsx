"use client";

import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { memo, useRef, useState, useEffect, useCallback, useMemo } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useNavigate, useLocation } from "react-router-dom";

import { env } from "@/app/env";
import { useTheme } from "@/components/providers/ThemeProvider";
import { defaultThemeConfig } from "@/config/themeConfig";
import { useResponsiveCollapsedMode, useThemedIcon } from "@/hooks/ui";
import {
  useAssistantsFeature,
  useSidebarFeature,
} from "@/providers/FeatureConfigProvider";
import { createLogger } from "@/utils/debugLogger";
import { checkFileExists } from "@/utils/themeUtils";

import { ChatHistoryList, ChatHistoryListSkeleton } from "./ChatHistoryList";
import { FrequentAssistantsList } from "./FrequentAssistantsList";
import { InteractiveContainer } from "../Container/InteractiveContainer";
import { Button } from "../Controls/Button";
import { UserProfileThemeDropdown } from "../Controls/UserProfileThemeDropdown";
import {
  SidebarToggleIcon,
  SearchIcon,
  EditIcon,
  ResolvedIcon,
  ChevronRightIcon,
} from "../icons";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "@/types/chat";

// Create logger for this component
const logger = createLogger("UI", "ChatHistorySidebar");

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
  onSessionArchive: (sessionId: string) => void;
  isLoading: boolean;
  error?: Error;
  userProfile?: UserProfile;
  /**
   * Callback when an assistant is selected to start a new chat
   */
  onAssistantSelect?: (assistantId: string) => void;
}

const SidebarLogo = memo<{
  logoPath: string;
  onToggle?: () => void;
}>(({ logoPath, onToggle }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Button
      onClick={onToggle}
      variant="sidebar-icon"
      aria-label={t`expand sidebar`}
      aria-expanded="false"
      className="relative size-10 p-0"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <img
        src={logoPath}
        alt={t`Logo`}
        className={clsx(
          "max-h-8 max-w-8 transition-opacity",
          isHovered && "opacity-30",
        )}
      />
      {isHovered && (
        <div className="absolute inset-0 flex items-center justify-center">
          <SidebarToggleIcon className="size-5" />
        </div>
      )}
    </Button>
  );
});

// eslint-disable-next-line lingui/no-unlocalized-strings
SidebarLogo.displayName = "SidebarLogo";

const ChatHistoryHeader = memo<{
  collapsed: boolean;
  isSlimMode: boolean;
  onToggleCollapse?: () => void;
  showTitle?: boolean;
  sidebarLogoPath?: string | null;
}>(
  ({ collapsed, isSlimMode, onToggleCollapse, showTitle, sidebarLogoPath }) => (
    <div className="flex min-h-[60px] border-b border-theme-border p-2">
      {/* In slim mode, show logo with hover toggle or just toggle button */}
      {isSlimMode && (
        <div className="flex w-12">
          {sidebarLogoPath ? (
            <SidebarLogo
              logoPath={sidebarLogoPath}
              onToggle={onToggleCollapse}
            />
          ) : (
            <Button
              onClick={onToggleCollapse}
              variant="sidebar-icon"
              icon={<SidebarToggleIcon />}
              aria-label={t`expand sidebar`}
              aria-expanded="false"
            />
          )}
        </div>
      )}
      {/* In expanded mode, show toggle button and title */}
      {/* Keep content rendered but use opacity transition to avoid header height jump */}
      {/* Only show when not in slim mode to prevent both buttons appearing simultaneously */}
      {!isSlimMode && (
        <div
          className={clsx(
            "flex w-full transition-opacity duration-300",
            collapsed ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          <div className="flex w-12 justify-center">
            <Button
              onClick={onToggleCollapse}
              variant="sidebar-icon"
              icon={<SidebarToggleIcon />}
              className="rotate-180"
              aria-label={t`collapse sidebar`}
              aria-expanded="true"
              tabIndex={collapsed ? -1 : 0}
            />
          </div>
          <div className="flex flex-1 items-center">
            {showTitle && (
              <h2 className="font-semibold text-theme-fg-primary">
                {t`Chat History`}
              </h2>
            )}
          </div>
        </div>
      )}
    </div>
  ),
);

// eslint-disable-next-line lingui/no-unlocalized-strings
ChatHistoryHeader.displayName = "ChatHistoryHeader";

const NewChatItem = memo<{
  onNewChat?: () => void;
  isSlimMode?: boolean;
}>(({ onNewChat, isSlimMode = false }) => {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal theme icon identifiers, not user-facing text
  const newChatIconId = useThemedIcon("navigation", "newChat");

  return (
    <div className="px-2 py-1">
      <InteractiveContainer
        useDiv={true}
        onClick={() => {
          logger.log("[CHAT_FLOW] New chat item clicked");
          onNewChat?.();
        }}
        className={clsx(
          "flex min-h-[44px] items-center rounded-lg text-left hover:bg-theme-bg-hover",
          isSlimMode ? "min-w-[44px] px-3 py-2" : "gap-3 px-3 py-2",
        )}
        aria-label={t`New Chat`}
        title={isSlimMode ? t`New Chat` : undefined}
      >
        <ResolvedIcon
          iconId={newChatIconId}
          fallbackIcon={EditIcon}
          className="size-4 shrink-0 text-theme-fg-secondary"
        />
        <span
          className={clsx(
            "whitespace-nowrap font-medium text-theme-fg-primary transition-opacity duration-150",
            isSlimMode
              ? "w-0 overflow-hidden opacity-0"
              : "opacity-100 delay-150",
          )}
        >
          {t`New Chat`}
        </span>
      </InteractiveContainer>
    </div>
  );
});

// eslint-disable-next-line lingui/no-unlocalized-strings
NewChatItem.displayName = "NewChatItem";

const SearchNavigationItem = memo<{
  onSearch?: () => void;
  isOnSearchPage?: boolean;
  isSlimMode?: boolean;
}>(({ onSearch, isOnSearchPage, isSlimMode = false }) => {
  const searchIconId = useThemedIcon("navigation", "search");

  return (
    <div className="px-2 py-1">
      {isOnSearchPage ? (
        <InteractiveContainer
          useDiv={true}
          interactive={false}
          className={clsx(
            "flex min-h-[44px] items-center rounded-lg text-left opacity-50",
            isSlimMode ? "min-w-[44px] px-3 py-2" : "gap-3 px-3 py-2",
          )}
          aria-label={t`Search`}
          title={isSlimMode ? t`Search` : undefined}
        >
          <ResolvedIcon
            iconId={searchIconId}
            fallbackIcon={SearchIcon}
            className="size-4 shrink-0 text-theme-fg-secondary"
          />
          <span
            className={clsx(
              "whitespace-nowrap font-medium text-theme-fg-primary transition-opacity duration-150",
              isSlimMode
                ? "w-0 overflow-hidden opacity-0"
                : "opacity-100 delay-150",
            )}
          >
            {t`Search`}
          </span>
        </InteractiveContainer>
      ) : (
        <a
          href="/search"
          onClick={(e) => {
            // Allow cmd/ctrl-click to open in new tab
            if (e.metaKey || e.ctrlKey) {
              return;
            }
            // Prevent default navigation for normal clicks
            e.preventDefault();
            logger.log("[CHAT_FLOW] Search navigation item clicked");
            onSearch?.();
          }}
          aria-label={t`Search`}
          title={isSlimMode ? t`Search` : undefined}
        >
          <InteractiveContainer
            useDiv={true}
            className={clsx(
              "flex min-h-[44px] items-center rounded-lg text-left hover:bg-theme-bg-hover",
              isSlimMode ? "min-w-[44px] px-3 py-2" : "gap-3 px-3 py-2",
            )}
          >
            <ResolvedIcon
              iconId={searchIconId}
              fallbackIcon={SearchIcon}
              className="size-4 shrink-0 text-theme-fg-secondary"
            />
            <span
              className={clsx(
                "whitespace-nowrap font-medium text-theme-fg-primary transition-opacity duration-150",
                isSlimMode
                  ? "w-0 overflow-hidden opacity-0"
                  : "opacity-100 delay-150",
              )}
            >
              {t`Search`}
            </span>
          </InteractiveContainer>
        </a>
      )}
    </div>
  );
});

// eslint-disable-next-line lingui/no-unlocalized-strings
SearchNavigationItem.displayName = "SearchNavigationItem";

const CollapsibleSection = memo<{
  title: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  className?: string;
}>(({ title, defaultExpanded = true, children, className }) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className={className}>
      <div className="px-2 py-1">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-theme-bg-hover"
          aria-expanded={isExpanded}
          aria-label={isExpanded ? t`Collapse ${title}` : t`Expand ${title}`}
          type="button"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide text-theme-fg-muted">
            {title}
          </h3>
          <ChevronRightIcon
            className={clsx(
              "size-3 text-theme-fg-muted transition-transform",
              isExpanded ? "rotate-90" : "rotate-0",
            )}
          />
        </button>
      </div>
      {isExpanded && <div>{children}</div>}
    </div>
  );
});

// eslint-disable-next-line lingui/no-unlocalized-strings
CollapsibleSection.displayName = "CollapsibleSection";

const ChatHistoryFooter = memo<{
  userProfile?: UserProfile;
  onSignOut: () => void;
  isSlimMode?: boolean;
}>(({ userProfile, onSignOut, isSlimMode = false }) => (
  <div className="border-t border-theme-border p-2">
    <UserProfileThemeDropdown
      userProfile={userProfile}
      onSignOut={onSignOut}
      className="flex w-full items-center"
      showThemeToggle={!isSlimMode}
    />
  </div>
));

// eslint-disable-next-line lingui/no-unlocalized-strings
ChatHistoryFooter.displayName = "ChatHistoryFooter";

const ErrorDisplay = ({ error }: { error: Error }) => (
  <div className="flex flex-col items-center justify-center p-4 text-theme-error-fg">
    <p className="font-medium">{t`Something went wrong`}</p>
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
    onSessionArchive,
    isLoading,
    error,
    userProfile,
    onAssistantSelect,
  }) => {
    const ref = useRef<HTMLElement>(null);
    const [sidebarLogoPath, setSidebarLogoPath] = useState<string | null>(null);
    const navigate = useNavigate();
    const location = useLocation();
    const isOnSearchPage = location.pathname === "/search";

    // Get sidebar configuration
    const {
      collapsedMode,
      logoPath: envLogoPath,
      logoDarkPath: envLogoDarkPath,
    } = useSidebarFeature();

    // Get responsive collapsed mode (forces hidden on mobile even if config is slim)
    const effectiveCollapsedMode = useResponsiveCollapsedMode(collapsedMode);

    // Memoize slim/hidden mode calculations using effective mode
    const isSlimMode = useMemo(
      () => collapsed && effectiveCollapsedMode === "slim",
      [collapsed, effectiveCollapsedMode],
    );
    const isHiddenMode = useMemo(
      () => collapsed && effectiveCollapsedMode === "hidden",
      [collapsed, effectiveCollapsedMode],
    );

    // Get theme information
    const { effectiveTheme, customThemeName } = useTheme();

    // Get assistants feature flag
    const { enabled: assistantsEnabled } = useAssistantsFeature();

    // Only use ResizeObserver in the browser
    const isBrowser = typeof window !== "undefined";

    // Memoize logo path resolution to avoid recalculating on every render
    const resolvedLogoPath = useMemo(() => {
      const isDark = effectiveTheme === "dark";
      // Check env vars first (from FeatureConfigProvider)
      if (isDark && envLogoDarkPath) return envLogoDarkPath;
      if (!isDark && envLogoPath) return envLogoPath;
      // Fall back to theme-based paths
      return defaultThemeConfig.getSidebarLogoPath(customThemeName, isDark);
    }, [effectiveTheme, customThemeName, envLogoPath, envLogoDarkPath]);

    // Load sidebar logo if configured
    useEffect(() => {
      if (!resolvedLogoPath) {
        setSidebarLogoPath(null);
        return;
      }

      const loadSidebarLogo = async () => {
        // Check if the logo file exists
        const exists = await checkFileExists(resolvedLogoPath);
        setSidebarLogoPath(exists ? resolvedLogoPath : null);
      };

      void loadSidebarLogo();
    }, [resolvedLogoPath]);

    // Memoize event handlers to prevent unnecessary re-renders of child components
    const handleSignOut = useCallback(() => {
      if (!isBrowser) return;

      try {
        const signOutUrl = "/oauth2/sign_out"; // eslint-disable-line lingui/no-unlocalized-strings
        window.location.href = signOutUrl;

        setTimeout(() => {
          const fullUrl = `${env().apiRootUrl}${signOutUrl}`;
          window.location.href = fullUrl;
        }, 1000);
      } catch (error) {
        logger.log("Failed to sign out:", error);
      }
    }, [isBrowser]);

    const handleSearchClick = useCallback(() => {
      logger.log("[CHAT_FLOW] Navigating to search page");
      navigate("/search");
    }, [navigate]);

    return (
      <ErrorBoundary FallbackComponent={ErrorDisplay}>
        <div className="relative h-auto">
          {/* Absolutely positioned toggle button when collapsed in hidden mode */}
          {isHiddenMode && (
            <div className="absolute left-2 top-2 z-30">
              <Button
                onClick={onToggleCollapse}
                variant="sidebar-icon"
                icon={<SidebarToggleIcon />}
                className="border border-theme-border bg-theme-bg-sidebar shadow-md"
                aria-label={t`expand sidebar`}
                aria-expanded="false"
              />
            </div>
          )}

          <aside
            ref={ref}
            className={clsx(
              "flex h-full flex-col border-r border-theme-border bg-theme-bg-sidebar",
              "fixed inset-y-0 left-0 z-40",
              "transition-[width,transform,opacity] duration-300 ease-in-out motion-reduce:transition-none",
              {
                // Hidden mode: slide completely off-screen
                "w-80 -translate-x-full opacity-0 pointer-events-none":
                  isHiddenMode,
                // Slim mode: slide to show 64px width
                "w-16 translate-x-0 opacity-100": isSlimMode,
                // Expanded mode: full width visible
                "w-80 translate-x-0 opacity-100": !collapsed,
              },
              className,
            )}
          >
            <ChatHistoryHeader
              collapsed={collapsed}
              isSlimMode={isSlimMode}
              onToggleCollapse={onToggleCollapse}
              showTitle={showTitle}
              sidebarLogoPath={sidebarLogoPath}
            />
            <div className="flex min-h-0 flex-1 flex-col">
              {/* New Chat Item */}
              <NewChatItem onNewChat={onNewChat} isSlimMode={isSlimMode} />

              {/* Search Navigation Item */}
              <SearchNavigationItem
                onSearch={handleSearchClick}
                isOnSearchPage={isOnSearchPage}
                isSlimMode={isSlimMode}
              />

              {/* Divider separating navigation items from content lists */}
              <div
                className={clsx(
                  "mx-2 my-1 border-t border-theme-border transition-opacity duration-200",
                  isSlimMode && "pointer-events-none opacity-0",
                )}
              />

              {/* Assistants Section - fade in/out instead of instant hide */}
              {assistantsEnabled && (
                <div
                  className={clsx(
                    "transition-opacity duration-200",
                    isSlimMode &&
                      "pointer-events-none overflow-hidden opacity-0",
                  )}
                >
                  <FrequentAssistantsList
                    onAssistantSelect={onAssistantSelect}
                    limit={5}
                  />
                </div>
              )}

              {/* Divider separating assistants from chat history */}
              {assistantsEnabled && (
                <div
                  className={clsx(
                    "mx-2 my-1 border-t border-theme-border transition-opacity duration-200",
                    isSlimMode && "pointer-events-none opacity-0",
                  )}
                />
              )}

              {/* Chat History - fade in/out with staggered timing */}
              <div
                className={clsx(
                  "flex-1 transition-opacity duration-200",
                  isSlimMode
                    ? "pointer-events-none overflow-hidden opacity-0"
                    : "overflow-y-auto",
                )}
              >
                {error ? (
                  <ErrorDisplay error={error} />
                ) : isLoading ? (
                  <ChatHistoryListSkeleton />
                ) : (
                  <CollapsibleSection
                    title={t({ id: "chat.history.recent", message: "Recent" })}
                    defaultExpanded={true}
                  >
                    <ChatHistoryList
                      sessions={sessions}
                      currentSessionId={currentSessionId}
                      onSessionSelect={onSessionSelect}
                      onSessionArchive={onSessionArchive}
                      showTimestamps={showTimestamps}
                    />
                  </CollapsibleSection>
                )}
              </div>
            </div>
            <ChatHistoryFooter
              userProfile={userProfile}
              onSignOut={handleSignOut}
              isSlimMode={isSlimMode}
            />
          </aside>
        </div>
      </ErrorBoundary>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
ChatHistorySidebar.displayName = "ChatHistorySidebar";
