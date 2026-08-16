"use client";

import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import clsx from "clsx";
import { memo, useRef, useState, useEffect, useCallback, useMemo } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useNavigate, useLocation } from "react-router-dom";

import { env } from "@/app/env";
import { useTheme } from "@/components/providers/ThemeProvider";
import {
  componentRegistry,
  resolveComponentOverride,
} from "@/config/componentRegistry";
import { defaultThemeConfig } from "@/config/themeConfig";
import {
  hasActiveFilters,
  sanitizeChatHistoryFilters,
  useChatHistoryFilterStore,
  useSanitizedChatHistoryFilters,
} from "@/hooks/chat/store/chatHistoryFilterStore";
import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import {
  selectAttentionCount,
  selectRunningCount,
  useGenerationStatusStore,
} from "@/hooks/chat/store/generationStatusStore";
import { useChatHistoryStore } from "@/hooks/chat/useChatHistory";
import { useResponsiveCollapsedMode, useThemedIcon } from "@/hooks/ui";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useAssistantHubConfig } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import {
  useAssistantsFeature,
  useSidebarFeature,
} from "@/providers/FeatureConfigProvider";
import { UNTITLED_BACKEND_SENTINEL } from "@/utils/chat/recentChatSession";
import {
  groupChatSessions,
  resolveChatAttentionStatus,
} from "@/utils/chatHistoryGrouping";
import { createLogger } from "@/utils/debugLogger";
import { checkFileExists } from "@/utils/themeUtils";

import { ChatHistoryFilterMenu } from "./ChatHistoryFilterMenu";
import { ChatHistoryList, ChatHistoryListSkeleton } from "./ChatHistoryList";
import { FrequentAssistantsList } from "./FrequentAssistantsList";
import {
  SidebarResizeHandle,
  useApplySidebarWidth,
} from "./SidebarResizeHandle";
import { InteractiveContainer } from "../Container/InteractiveContainer";
import { Button } from "../Controls/Button";
import { UserProfileThemeDropdown } from "../Controls/UserProfileThemeDropdown";
import { CopyErrorButton } from "../Feedback/CopyErrorButton";
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
// Nav rows and chat rows share one themeable geometry class so a single
// theme.css channel reaches both row families.
const sidebarItemClassName = "sidebar-row-geometry";
const activeSidebarItemClassName = "sidebar-row-geometry sidebar-row-selected";
// Horizontal inset for every row surface; see .sidebar-inset-geometry.
const sidebarInsetClassName = "sidebar-inset-geometry";
const sidebarLinkClassName =
  "focus-ring-tight block rounded-[var(--theme-radius-shell)]";

const RECENT_CHATS_SECTION_EXPANDED_STORAGE_KEY =
  "erato.sidebar.recentChatsSectionExpanded";
const PINNED_CHATS_SECTION_EXPANDED_STORAGE_KEY =
  "erato.sidebar.pinnedChatsSectionExpanded";

const ASSISTANTS_SECTION_EXPANDED_STORAGE_KEY =
  "erato.sidebar.assistantsSectionExpanded";

const parsePersistedBoolean = (value: unknown) =>
  typeof value === "boolean" ? value : null;

const GENERATION_ANNOUNCE_DEBOUNCE_MS = 1000;

const generationBadgeClassName =
  // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS utility classes, not user-facing text
  "flex min-w-4 items-center justify-center rounded-full bg-theme-action-primary-bg px-1 text-[10px] font-semibold leading-4 text-theme-action-primary-fg";

/**
 * Running + session-observed finished/error + chats awaiting a tool
 * decision. The latter come from two channels — the mount-driven
 * confirmation registry (open chat) and the server-seeded status store
 * (everything else) — deduplicated by chat id.
 */
const useGenerationIndicatorCount = (): number => {
  const runningCount = useGenerationStatusStore(selectRunningCount);
  const attentionCount = useGenerationStatusStore(selectAttentionCount);
  const statusByChatId = useGenerationStatusStore(
    (state) => state.statusByChatId,
  );
  const pendingIdsByChatId = useConfirmationRegistryStore(
    (state) => state.pendingIdsByChatId,
  );
  const actionRequiredCount = useMemo(() => {
    const chatIds = new Set(Object.keys(pendingIdsByChatId));
    for (const [chatId, status] of Object.entries(statusByChatId)) {
      if (status?.kind === "action_required") {
        chatIds.add(chatId);
      }
    }
    return chatIds.size;
  }, [pendingIdsByChatId, statusByChatId]);
  return runningCount + attentionCount + actionRequiredCount;
};

/**
 * Count badge for the collapsed-rail toggles; anchors on the nearest
 * positioned ancestor.
 */
const GenerationRailBadge = () => {
  const count = useGenerationIndicatorCount();

  if (count === 0) return null;

  return (
    <span
      data-testid="sidebar-generation-badge"
      aria-hidden="true"
      className={clsx("absolute -right-0.5 -top-0.5", generationBadgeClassName)}
    >
      {count}
    </span>
  );
};

export interface ChatHistorySidebarProps {
  className?: string;
  /**
   * Whether the sidebar is collapsed
   * @default false
   */
  collapsed?: boolean;
  /**
   * Minimum width of the sidebar when expanded
   * @default theme layout token
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
  onSessionEditTitle?: (sessionId: string) => void;
  onSessionShare?: (sessionId: string) => void;
  pinnedSessions?: ChatSession[];
  onSessionPin?: (sessionId: string, isPinned: boolean) => void;
  pinnedChatsLimit?: number;
  isLoading: boolean;
  error?: Error;
  userProfile?: UserProfile;
  hasMoreSessions?: boolean;
  isLoadingMoreSessions?: boolean;
  onLoadMoreSessions?: () => void;
}

const SidebarLogo = memo<{
  logoPath: string;
  onToggle?: () => void;
}>(({ logoPath, onToggle }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [logoPath]);

  if (imgFailed) {
    return (
      <Button
        onClick={onToggle}
        variant="sidebar-icon"
        icon={<SidebarToggleIcon />}
        className="sidebar-icon-col-geometry"
        aria-label={t`expand sidebar`}
        aria-expanded="false"
      />
    );
  }

  return (
    <Button
      onClick={onToggle}
      variant="sidebar-icon"
      aria-label={t`expand sidebar`}
      aria-expanded="false"
      className="sidebar-icon-col-geometry sidebar-icon-col-geometry-logo relative size-10 p-0"
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
        onError={() => setImgFailed(true)}
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
    <div
      className="sidebar-section-skin sidebar-band-geometry flex border-b"
      data-ui="sidebar-header"
    >
      {/* In slim mode, show logo with hover toggle or just toggle button */}
      {isSlimMode && (
        <div className="flex w-full items-center">
          <div className="relative">
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
                className="sidebar-icon-col-geometry"
                aria-label={t`expand sidebar`}
                aria-expanded="false"
              />
            )}
            <GenerationRailBadge />
          </div>
        </div>
      )}
      {/* In expanded mode, show toggle button and title */}
      {/* Keep content rendered but use opacity transition to avoid header height jump */}
      {/* Only show when not in slim mode to prevent both buttons appearing simultaneously */}
      {!isSlimMode && (
        <div
          className={clsx(
            "flex w-full items-center transition-opacity duration-300",
            collapsed ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          <Button
            onClick={onToggleCollapse}
            variant="sidebar-icon"
            icon={<SidebarToggleIcon />}
            className="sidebar-icon-col-geometry rotate-180"
            aria-label={t`collapse sidebar`}
            aria-expanded="true"
            tabIndex={collapsed ? -1 : 0}
          />
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
    <div className={clsx(sidebarInsetClassName, "py-1")}>
      <InteractiveContainer
        useDiv={true}
        onClick={() => {
          logger.log("[CHAT_FLOW] New chat item clicked");
          onNewChat?.();
        }}
        className={clsx(
          sidebarItemClassName,
          "theme-transition flex items-center text-left hover:bg-[var(--theme-shell-sidebar-hover)]",
          "sidebar-content-col-geometry gap-3 py-2 pr-3",
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
    <div className={clsx(sidebarInsetClassName, "py-1")}>
      {isOnSearchPage ? (
        <InteractiveContainer
          useDiv={true}
          interactive={false}
          className={clsx(
            activeSidebarItemClassName,
            "flex items-center text-left",
            "sidebar-content-col-geometry gap-3 py-2 pr-3",
          )}
          aria-label={t`Search`}
          title={isSlimMode ? t`Search` : undefined}
          data-ui="sidebar-search-item"
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
          className={sidebarLinkClassName}
          aria-label={t`Search`}
          title={isSlimMode ? t`Search` : undefined}
        >
          <InteractiveContainer
            useDiv={true}
            showFocusRing={false}
            className={clsx(
              sidebarItemClassName,
              "theme-transition flex items-center text-left hover:bg-[var(--theme-shell-sidebar-hover)]",
              "sidebar-content-col-geometry gap-3 py-2 pr-3",
            )}
            data-ui="sidebar-search-item"
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

const AssistantsNavigationItem = memo<{
  href: string;
  onAssistants?: () => void;
  isOnAssistantsPage?: boolean;
  isSlimMode?: boolean;
}>(({ href, onAssistants, isOnAssistantsPage, isSlimMode = false }) => {
  const assistantsIconId = useThemedIcon("navigation", "assistants");

  return (
    <div className={clsx(sidebarInsetClassName, "py-1")}>
      {isOnAssistantsPage ? (
        <InteractiveContainer
          useDiv={true}
          interactive={false}
          className={clsx(
            activeSidebarItemClassName,
            "flex items-center text-left",
            "sidebar-content-col-geometry gap-3 py-2 pr-3",
          )}
          aria-label={t`Assistants`}
          title={isSlimMode ? t`Assistants` : undefined}
          data-ui="sidebar-assistants-item"
        >
          <ResolvedIcon
            iconId={assistantsIconId}
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
            {t`Assistants`}
          </span>
        </InteractiveContainer>
      ) : (
        <a
          href={href}
          onClick={(e) => {
            // Allow cmd/ctrl-click to open in new tab
            if (e.metaKey || e.ctrlKey) {
              return;
            }
            // Prevent default navigation for normal clicks
            e.preventDefault();
            logger.log("[ASSISTANTS_FLOW] Assistants navigation item clicked");
            onAssistants?.();
          }}
          className={sidebarLinkClassName}
          aria-label={t`Assistants`}
          title={isSlimMode ? t`Assistants` : undefined}
        >
          <InteractiveContainer
            useDiv={true}
            showFocusRing={false}
            className={clsx(
              sidebarItemClassName,
              "theme-transition flex items-center text-left hover:bg-[var(--theme-shell-sidebar-hover)]",
              "sidebar-content-col-geometry gap-3 py-2 pr-3",
            )}
            data-ui="sidebar-assistants-item"
          >
            <ResolvedIcon
              iconId={assistantsIconId}
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
              {t`Assistants`}
            </span>
          </InteractiveContainer>
        </a>
      )}
    </div>
  );
});

// eslint-disable-next-line lingui/no-unlocalized-strings
AssistantsNavigationItem.displayName = "AssistantsNavigationItem";

const CollapsibleSection = memo<{
  title: string;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Right-aligned header controls; a sibling of the collapse toggle so they
   * never sit inside its click target. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}>(
  ({
    title,
    defaultExpanded = true,
    expanded,
    onExpandedChange,
    actions,
    children,
    className,
  }) => {
    const [uncontrolledExpanded, setUncontrolledExpanded] =
      useState(defaultExpanded);
    const isExpanded = expanded ?? uncontrolledExpanded;
    const setIsExpanded = onExpandedChange ?? setUncontrolledExpanded;

    return (
      <div className={className}>
        <div
          className={clsx(
            sidebarInsetClassName,
            "group flex items-center gap-1 py-1",
          )}
        >
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={clsx(
              sidebarItemClassName,
              "sidebar-content-col-geometry group/toggle flex min-w-0 flex-1 items-center gap-1.5 py-2 pr-3 text-left",
            )}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? t`Collapse ${title}` : t`Expand ${title}`}
            type="button"
          >
            <h3 className="theme-transition truncate text-xs font-semibold uppercase tracking-wide text-theme-fg-muted group-hover/toggle:text-theme-fg-primary group-focus-visible/toggle:text-theme-fg-primary">
              {title}
            </h3>
            <ChevronRightIcon
              className={clsx(
                "theme-transition size-3 shrink-0 text-theme-fg-muted group-hover/toggle:text-theme-fg-primary group-focus-visible/toggle:text-theme-fg-primary",
                "opacity-0 group-hover:opacity-100 group-focus-visible/toggle:opacity-100",
                // Touch devices get no hover reveal, so the non-default
                // collapsed state must stay visible on its own.
                !isExpanded && "opacity-100",
                isExpanded ? "rotate-90" : "rotate-0",
              )}
            />
          </button>
          {actions != null && (
            <div className="flex shrink-0 items-center">{actions}</div>
          )}
        </div>
        {/* The chat-list inset lives on this host-owned wrapper rather than
            inside ChatHistoryList, which customers replace wholesale via the
            registry slot. */}
        {isExpanded && <div className={sidebarInsetClassName}>{children}</div>}
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
CollapsibleSection.displayName = "CollapsibleSection";

const ChatHistoryFooter = memo<{
  userProfile?: UserProfile;
  onSignOut: () => void;
  isSlimMode?: boolean;
}>(({ userProfile, onSignOut }) => (
  <div
    className="sidebar-section-skin sidebar-band-geometry flex items-center border-t"
    data-ui="sidebar-footer"
  >
    {/* The trigger's rail-column margin holds in both modes, so the slim
        rail needs no extra centering here. */}
    <UserProfileThemeDropdown
      userProfile={userProfile}
      onSignOut={onSignOut}
      className="flex w-full items-center"
    />
  </div>
));

// eslint-disable-next-line lingui/no-unlocalized-strings
ChatHistoryFooter.displayName = "ChatHistoryFooter";

const NoFilterMatchesRow = () => (
  <p
    className="sidebar-content-col-geometry py-2 pr-3 text-xs text-theme-fg-muted"
    data-testid="chat-history-no-filter-matches"
  >
    {t({
      id: "chat.history.filterMenu.noMatches",
      message: "No chats match the current filters",
    })}
  </p>
);

const ErrorDisplay = ({ error }: { error: Error }) => (
  <div className="flex flex-col items-center justify-center p-4 text-theme-error-fg">
    <p className="font-medium">{t`Something went wrong`}</p>
    <p className="text-sm">{error.message}</p>
    <CopyErrorButton error={error} className="mt-3" />
  </div>
);

export const ChatHistorySidebar = memo<ChatHistorySidebarProps>(
  ({
    className,
    collapsed = false,
    minWidth,
    onNewChat,
    onToggleCollapse,
    showTitle = false,
    showTimestamps = true,
    sessions,
    currentSessionId,
    onSessionSelect,
    onSessionArchive,
    onSessionEditTitle,
    onSessionShare,
    pinnedSessions = [],
    onSessionPin,
    pinnedChatsLimit = 5,
    isLoading,
    error,
    userProfile,
    hasMoreSessions = false,
    isLoadingMoreSessions = false,
    onLoadMoreSessions,
  }) => {
    const ref = useRef<HTMLElement>(null);
    const [sidebarLogoPath, setSidebarLogoPath] = useState<string | null>(null);
    const navigate = useNavigate();
    const location = useLocation();
    const isOnSearchPage = location.pathname === "/search";
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal route path
    const assistantsRoute = "/assistants";
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal route path
    const assistantHubRoute = "/assistant-hub";
    const isOnAssistantsPage =
      location.pathname.startsWith(assistantsRoute) ||
      location.pathname.startsWith(assistantHubRoute);

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

    // Apply any user-dragged sidebar width as the width-token override.
    useApplySidebarWidth();

    // Get assistants feature flag
    const {
      enabled: assistantsEnabled,
      showRecentItems: assistantsShowRecent,
      showRecentItemsCollapsible: assistantsShowRecentCollapsible,
    } = useAssistantsFeature();
    const { data: assistantHubConfig, isLoading: isLoadingAssistantHubConfig } =
      useAssistantHubConfig({});
    const assistantsLandingRoute = assistantHubConfig?.enabled
      ? assistantHubRoute
      : assistantsRoute;
    const showAssistantsNavigation =
      !isLoadingAssistantHubConfig &&
      (assistantsEnabled || assistantHubConfig?.enabled === true);
    const [isRecentChatsExpanded, setIsRecentChatsExpanded] = usePersistedState(
      RECENT_CHATS_SECTION_EXPANDED_STORAGE_KEY,
      true,
      {
        parse: parsePersistedBoolean,
      },
    );
    const [isPinnedChatsExpanded, setIsPinnedChatsExpanded] = usePersistedState(
      PINNED_CHATS_SECTION_EXPANDED_STORAGE_KEY,
      true,
      { parse: parsePersistedBoolean },
    );
    const [isAssistantsExpanded, setIsAssistantsExpanded] = usePersistedState(
      ASSISTANTS_SECTION_EXPANDED_STORAGE_KEY,
      true,
      {
        parse: parsePersistedBoolean,
      },
    );

    const generationStatusByChatId = useGenerationStatusStore(
      (state) => state.statusByChatId,
    );

    // Fold assistant-scoped filter values back to their defaults in the store
    // itself: the recent-chats query (and any other reader) consumes the raw
    // persisted values, so sanitizing only at render would let a stale
    // persisted value keep filtering the request invisibly.
    useEffect(() => {
      if (assistantsEnabled) return;
      const store = useChatHistoryFilterStore.getState();
      const sanitized = sanitizeChatHistoryFilters(store, false);
      if (sanitized.typeFilter !== store.typeFilter) {
        store.setTypeFilter(sanitized.typeFilter);
      }
      if (sanitized.groupBy !== store.groupBy) {
        store.setGroupBy(sanitized.groupBy);
      }
    }, [assistantsEnabled]);

    const chatHistoryFilters =
      useSanitizedChatHistoryFilters(assistantsEnabled);
    // Grouped-mode collapse state is per-mount on purpose: date-bucket keys
    // churn daily, so persisting them would accumulate stale entries.
    const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<
      ReadonlySet<string>
    >(() => new Set());
    const setGroupExpanded = useCallback((key: string, expanded: boolean) => {
      setCollapsedGroupKeys((previous) => {
        const next = new Set(previous);
        if (expanded) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
    }, []);
    const pendingConfirmationIdsByChatId = useConfirmationRegistryStore(
      (state) => state.pendingIdsByChatId,
    );
    const { i18n } = useLingui();
    const recentChatGroups = useMemo(
      () =>
        groupChatSessions(sessions, chatHistoryFilters.groupBy, {
          now: new Date(),
          locale: i18n.locale,
          needsAttention: (session) =>
            resolveChatAttentionStatus(
              generationStatusByChatId[session.id],
              (pendingConfirmationIdsByChatId[session.id]?.length ?? 0) > 0,
            ) !== null,
        }),
      [
        sessions,
        chatHistoryFilters.groupBy,
        i18n.locale,
        generationStatusByChatId,
        pendingConfirmationIdsByChatId,
      ],
    );

    // The infinite-scroll sentinel must sit inside a visible list, so it
    // follows the last still-expanded group rather than simply the last one.
    // With every group collapsed there is no sentinel at all.
    const lastExpandedGroupKey = useMemo(
      () =>
        recentChatGroups.findLast((group) => !collapsedGroupKeys.has(group.key))
          ?.key ?? null,
      [recentChatGroups, collapsedGroupKeys],
    );

    // Tab title is owned here rather than by ChatHistoryList: several list
    // instances render at once (pinned + one per group), and an instance not
    // containing the current chat cannot tell "not mine" from "no title yet".
    const currentTitleHint = useChatHistoryStore((state) =>
      currentSessionId ? state.titleHintByChatId[currentSessionId] : undefined,
    );
    const currentSession = useMemo(
      () =>
        currentSessionId
          ? (sessions.find((s) => s.id === currentSessionId) ??
            pinnedSessions.find((s) => s.id === currentSessionId))
          : undefined,
      [sessions, pinnedSessions, currentSessionId],
    );
    const rawCurrentTitle =
      currentSession?.titleResolved ?? currentSession?.title;
    const currentSessionTitle =
      rawCurrentTitle && rawCurrentTitle !== UNTITLED_BACKEND_SENTINEL
        ? rawCurrentTitle
        : (currentTitleHint ?? currentSession?.title);

    useEffect(() => {
      if (typeof currentSessionTitle === "undefined") {
        return;
      }
      const pageTitle = t({ id: "branding.page_title_suffix" });
      document.title = `${currentSessionTitle} - ${pageTitle}`;
    }, [currentSessionTitle]);

    // Screen-reader summary of generation activity, excluding the chat the
    // user is viewing.
    const generationLiveSummary = useMemo(() => {
      let running = 0;
      let finished = 0;
      let errored = 0;
      for (const [chatId, status] of Object.entries(generationStatusByChatId)) {
        if (!status || chatId === currentSessionId) continue;
        if (status.kind === "running") running += 1;
        else if (status.kind === "finished") finished += 1;
        else if (status.kind === "error") errored += 1;
      }
      const parts: string[] = [];
      if (running > 0) {
        parts.push(
          t({
            id: "chat.history.generation.liveRunning",
            message: plural(running, {
              one: "# chat generating",
              other: "# chats generating",
            }),
          }),
        );
      }
      if (finished > 0) {
        parts.push(
          t({
            id: "chat.history.generation.liveFinished",
            message: plural(finished, {
              one: "# chat finished",
              other: "# chats finished",
            }),
          }),
        );
      }
      if (errored > 0) {
        parts.push(
          t({
            id: "chat.history.generation.liveError",
            message: plural(errored, {
              one: "# chat failed",
              other: "# chats failed",
            }),
          }),
        );
      }
      return parts.join(", ");
    }, [generationStatusByChatId, currentSessionId]);

    // Debounced so a burst of transitions produces one announcement.
    const [generationAnnouncement, setGenerationAnnouncement] = useState("");
    const generationAnnounceTimeoutRef = useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

    useEffect(() => {
      if (generationAnnounceTimeoutRef.current) {
        clearTimeout(generationAnnounceTimeoutRef.current);
      }
      generationAnnounceTimeoutRef.current = setTimeout(() => {
        setGenerationAnnouncement(generationLiveSummary);
      }, GENERATION_ANNOUNCE_DEBOUNCE_MS);
      return () => {
        if (generationAnnounceTimeoutRef.current) {
          clearTimeout(generationAnnounceTimeoutRef.current);
        }
      };
    }, [generationLiveSummary]);

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

    const handleAssistantsClick = useCallback(() => {
      logger.log("[ASSISTANTS_FLOW] Navigating to assistants page");
      navigate(assistantsLandingRoute);
    }, [assistantsLandingRoute, navigate]);

    const expandedSidebarWidth = useMemo(
      () =>
        typeof minWidth === "number"
          ? `${minWidth}px`
          : // The override variable carries a user-dragged width; the theme
            // token stays untouched because the theme pipeline clears root
            // inline values for every --theme-* variable when it applies.
            "var(--sidebar-width-override, var(--theme-layout-sidebar-width))",
      [minWidth],
    );

    // Width is runtime state (slim vs expanded); the surface lives in
    // .sidebar-skin so [data-ui="sidebar"] stays themeable.
    const sidebarShellStyle = useMemo(
      () => ({
        width: isSlimMode
          ? "var(--theme-layout-sidebar-slim-width)"
          : expandedSidebarWidth,
      }),
      [expandedSidebarWidth, isSlimMode],
    );

    const hiddenToggleStyle = useMemo(
      () => ({
        backgroundColor: "var(--theme-shell-sidebar)",
        borderColor: "var(--theme-border-divider)",
        borderRadius: "var(--theme-radius-shell)",
        boxShadow: "var(--theme-elevation-shell)",
      }),
      [],
    );

    const ResolvedChatHistoryList = useMemo(
      () =>
        resolveComponentOverride(
          componentRegistry.ChatHistoryList,
          ChatHistoryList,
        ),
      [],
    );

    return (
      <ErrorBoundary FallbackComponent={ErrorDisplay}>
        <div className="relative h-auto">
          <div
            role="status"
            className="sr-only"
            data-testid="sidebar-generation-live-region"
          >
            {generationAnnouncement}
          </div>
          {/* Absolutely positioned toggle button when collapsed in hidden mode */}
          {isHiddenMode && (
            <div className="absolute left-2 top-2 z-30">
              <Button
                onClick={onToggleCollapse}
                variant="sidebar-icon"
                icon={<SidebarToggleIcon />}
                className="border"
                style={hiddenToggleStyle}
                aria-label={t`expand sidebar`}
                aria-expanded="false"
              />
              <GenerationRailBadge />
            </div>
          )}

          <aside
            ref={ref}
            className={clsx(
              "flex h-full flex-col border-r",
              "fixed inset-y-0 left-0 z-40",
              "transition-[width,transform,opacity] duration-300 ease-in-out motion-reduce:transition-none",
              // Hidden mode: slide completely off-screen
              isHiddenMode && "pointer-events-none -translate-x-full opacity-0",
              // Slim and expanded modes stay visible
              !isHiddenMode && "translate-x-0 opacity-100",
              "sidebar-skin",
              className,
            )}
            style={sidebarShellStyle}
            data-ui="sidebar"
            data-sidebar-mode={
              isHiddenMode ? "hidden" : isSlimMode ? "slim" : "expanded"
            }
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

              {showAssistantsNavigation && (
                <AssistantsNavigationItem
                  href={assistantsLandingRoute}
                  onAssistants={handleAssistantsClick}
                  isOnAssistantsPage={isOnAssistantsPage}
                  isSlimMode={isSlimMode}
                />
              )}

              {/* Divider separating navigation items from content lists */}
              <div
                className={clsx(
                  "mx-[var(--theme-spacing-shell-compact-padding-x)] my-1 border-t border-[var(--theme-border-divider)] transition-opacity duration-200",
                  isSlimMode && "pointer-events-none opacity-0",
                )}
                data-ui="sidebar-nav-divider"
              />

              {/* Optional recent assistants section */}
              {assistantsEnabled &&
                assistantsShowRecent &&
                !collapsed &&
                (assistantsShowRecentCollapsible ? (
                  <CollapsibleSection
                    title={t`Assistants`}
                    defaultExpanded={true}
                    expanded={isAssistantsExpanded}
                    onExpandedChange={setIsAssistantsExpanded}
                    className={clsx(
                      "transition-opacity duration-200",
                      isSlimMode &&
                        "pointer-events-none overflow-hidden opacity-0",
                    )}
                  >
                    <FrequentAssistantsList
                      limit={5}
                      showBottomDivider={true}
                    />
                  </CollapsibleSection>
                ) : (
                  <div
                    className={clsx(
                      sidebarInsetClassName,
                      "transition-opacity duration-200",
                      isSlimMode &&
                        "pointer-events-none overflow-hidden opacity-0",
                    )}
                  >
                    <FrequentAssistantsList
                      limit={5}
                      showBottomDivider={true}
                    />
                  </div>
                ))}

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
                  <div className={sidebarInsetClassName}>
                    <ChatHistoryListSkeleton />
                  </div>
                ) : (
                  <>
                    {pinnedSessions.length > 0 && onSessionPin && (
                      <CollapsibleSection
                        title={t({
                          id: "chat.history.pinned",
                          message: "Pinned",
                        })}
                        defaultExpanded={true}
                        expanded={isPinnedChatsExpanded}
                        onExpandedChange={setIsPinnedChatsExpanded}
                      >
                        <ResolvedChatHistoryList
                          sessions={pinnedSessions}
                          currentSessionId={currentSessionId}
                          onSessionSelect={onSessionSelect}
                          onSessionArchive={onSessionArchive}
                          onSessionEditTitle={onSessionEditTitle}
                          onSessionShare={onSessionShare}
                          onSessionPin={onSessionPin}
                          pinnedChatsCount={pinnedSessions.length}
                          pinnedChatsLimit={pinnedChatsLimit}
                          showTimestamps={showTimestamps}
                        />
                      </CollapsibleSection>
                    )}
                    {chatHistoryFilters.groupBy === "none" ? (
                      <CollapsibleSection
                        title={t({
                          id: "chat.history.recent",
                          message: "Recent",
                        })}
                        defaultExpanded={true}
                        expanded={isRecentChatsExpanded}
                        onExpandedChange={setIsRecentChatsExpanded}
                        actions={
                          <ChatHistoryFilterMenu
                            assistantsEnabled={assistantsEnabled}
                          />
                        }
                      >
                        {sessions.length === 0 &&
                        hasActiveFilters(chatHistoryFilters) ? (
                          <NoFilterMatchesRow />
                        ) : (
                          <ResolvedChatHistoryList
                            sessions={sessions}
                            currentSessionId={currentSessionId}
                            onSessionSelect={onSessionSelect}
                            onSessionArchive={onSessionArchive}
                            onSessionEditTitle={onSessionEditTitle}
                            onSessionShare={onSessionShare}
                            onSessionPin={onSessionPin}
                            pinnedChatsCount={pinnedSessions.length}
                            pinnedChatsLimit={pinnedChatsLimit}
                            showTimestamps={showTimestamps}
                            hasMore={hasMoreSessions}
                            isLoadingMore={isLoadingMoreSessions}
                            onLoadMore={onLoadMoreSessions}
                          />
                        )}
                      </CollapsibleSection>
                    ) : recentChatGroups.length === 0 ? (
                      // No group headers exist to host the filter menu, so a
                      // bare header row keeps its trigger reachable.
                      <>
                        <div
                          className={clsx(
                            sidebarInsetClassName,
                            "flex items-center justify-end py-1",
                          )}
                          data-ui="chat-history-filter-row"
                        >
                          <ChatHistoryFilterMenu
                            assistantsEnabled={assistantsEnabled}
                          />
                        </div>
                        {hasActiveFilters(chatHistoryFilters) && (
                          <div className={sidebarInsetClassName}>
                            <NoFilterMatchesRow />
                          </div>
                        )}
                      </>
                    ) : (
                      recentChatGroups.map((group, index) => {
                        const carriesLoadMore =
                          group.key === lastExpandedGroupKey;
                        return (
                          <div key={group.key} data-ui="chat-history-group">
                            <CollapsibleSection
                              title={group.label ?? ""}
                              expanded={!collapsedGroupKeys.has(group.key)}
                              onExpandedChange={(expanded) =>
                                setGroupExpanded(group.key, expanded)
                              }
                              actions={
                                index === 0 ? (
                                  <ChatHistoryFilterMenu
                                    assistantsEnabled={assistantsEnabled}
                                  />
                                ) : undefined
                              }
                            >
                              <ResolvedChatHistoryList
                                sessions={group.sessions}
                                currentSessionId={currentSessionId}
                                onSessionSelect={onSessionSelect}
                                onSessionArchive={onSessionArchive}
                                onSessionEditTitle={onSessionEditTitle}
                                onSessionShare={onSessionShare}
                                onSessionPin={onSessionPin}
                                pinnedChatsCount={pinnedSessions.length}
                                pinnedChatsLimit={pinnedChatsLimit}
                                showTimestamps={showTimestamps}
                                hasMore={
                                  carriesLoadMore ? hasMoreSessions : false
                                }
                                isLoadingMore={
                                  carriesLoadMore
                                    ? isLoadingMoreSessions
                                    : false
                                }
                                onLoadMore={
                                  carriesLoadMore
                                    ? onLoadMoreSessions
                                    : undefined
                                }
                              />
                            </CollapsibleSection>
                          </div>
                        );
                      })
                    )}
                  </>
                )}
              </div>
            </div>
            <ChatHistoryFooter
              userProfile={userProfile}
              onSignOut={handleSignOut}
              isSlimMode={isSlimMode}
            />
            {!collapsed && <SidebarResizeHandle />}
          </aside>
        </div>
      </ErrorBoundary>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
ChatHistorySidebar.displayName = "ChatHistorySidebar";
