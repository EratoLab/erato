"use client";

import { plural, t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";
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
import {
  hasActiveFilters,
  useChatHistoryFilterFoldback,
  useSanitizedChatHistoryFilters,
} from "@/hooks/chat/store/chatHistoryFilterStore";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { useChatHistoryStore } from "@/hooks/chat/useChatHistory";
import { useGenerationIndicatorCount } from "@/hooks/chat/useGenerationIndicatorCount";
import {
  useGroupedChatSessions,
  useGroupedLoadMorePaused,
} from "@/hooks/chat/useGroupedChatSessions";
import { useScheduledFailureAlertShown } from "@/hooks/scheduled/useScheduledItems";
import {
  useIsNarrowScreen,
  useResponsiveCollapsedMode,
  useThemedIcon,
} from "@/hooks/ui";
import { usePersistedState } from "@/hooks/usePersistedState";
import {
  useAssistantHubConfig,
  useChatDetail,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { claimLeftEdge, LEFT_EDGE_SWIPE_CAPABILITY } from "@/lib/hostLeftEdge";
import { hostShellWithCapability } from "@/lib/hostShell";
import {
  useAssistantsFeature,
  useScheduledFeature,
  useSidebarFeature,
} from "@/providers/FeatureConfigProvider";
import { UNTITLED_BACKEND_SENTINEL } from "@/utils/chat/recentChatSession";
import { getAssistantUrl } from "@/utils/chat/urlUtils";
import { createLogger } from "@/utils/debugLogger";
import { isImeComposing } from "@/utils/isImeComposing";

import { ChatHistoryFilterMenu } from "./ChatHistoryFilterMenu";
import { ChatHistoryList, ChatHistoryListSkeleton } from "./ChatHistoryList";
import { FrequentAssistantsList } from "./FrequentAssistantsList";
import { SidebarBand } from "./SidebarBand";
import {
  parsePersistedBoolean,
  SidebarCollapsibleSection as CollapsibleSection,
  sidebarInsetClassName,
} from "./SidebarCollapsibleSection";
import {
  SidebarNavigationItem,
  sidebarNavigationIconClassName,
} from "./SidebarNavigationItem";
import {
  SidebarResizeHandle,
  useApplySidebarWidth,
} from "./SidebarResizeHandle";
import { SidebarToggle } from "./SidebarToggle";
import { useSidebarPushesPage } from "./sidebarPage";
import { useSidebarDrawerSwipe } from "./useSidebarDrawerSwipe";
import { UserProfileThemeDropdown } from "../Controls/UserProfileThemeDropdown";
import { CopyErrorButton } from "../Feedback/CopyErrorButton";
import {
  SidebarToggleIcon,
  SearchIcon,
  EditIcon,
  PlusIcon,
  CalendarIcon,
  ResolvedIcon,
} from "../icons";
import { ERATO_GEOMETRY_CLASS } from "../styles/geometryClassNames";

import type { SidebarToggleSurface } from "./SidebarToggle";
import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "@/types/chat";
import type { ReactNode, Ref, RefObject } from "react";

// Create logger for this component
const logger = createLogger("UI", "ChatHistorySidebar");

const RECENT_CHATS_SECTION_EXPANDED_STORAGE_KEY =
  "erato.sidebar.recentChatsSectionExpanded";
const PINNED_CHATS_SECTION_EXPANDED_STORAGE_KEY =
  "erato.sidebar.pinnedChatsSectionExpanded";

const ASSISTANTS_SECTION_EXPANDED_STORAGE_KEY =
  "erato.sidebar.assistantsSectionExpanded";

const GENERATION_ANNOUNCE_DEBOUNCE_MS = 1000;

/**
 * The expand control, wherever the sidebar is collapsed. It reads the
 * attention count itself so a count change repaints this button rather than
 * the whole sidebar, and says the number aloud because the badge that draws
 * it is aria-hidden.
 */
const SidebarExpandToggle = ({
  ref,
  surface,
  onToggle,
  className,
  children,
}: {
  ref?: Ref<HTMLButtonElement>;
  surface: SidebarToggleSurface;
  onToggle?: () => void;
  className?: string;
  children?: ReactNode;
}) => {
  const attentionCount = useGenerationIndicatorCount();

  return (
    <SidebarToggle
      ref={ref}
      surface={surface}
      expanded={false}
      onClick={onToggle}
      label={
        attentionCount > 0
          ? t({
              id: "chat.history.generation.expandWithAttention",
              message: plural(attentionCount, {
                one: "expand sidebar, # chat needs attention",
                other: "expand sidebar, # chats need attention",
              }),
            })
          : t`expand sidebar`
      }
      attentionCount={attentionCount}
      badgeTestId="sidebar-generation-badge"
      className={className}
    >
      {children}
    </SidebarToggle>
  );
};

export interface ChatHistorySidebarProps {
  className?: string;
  /**
   * Whether the sidebar is collapsed
   * @default false
   */
  collapsed?: boolean;
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
  onSessionUnarchive: (sessionId: string) => void;
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
  /**
   * The page rendered beside the sidebar (see `useSidebarPage`). On a narrow
   * screen a drag moves it with the sidebar.
   */
  pageRef?: RefObject<HTMLElement | null>;
}

const SidebarLogo = memo<{
  logoPath: string;
  onToggle?: () => void;
}>(({ logoPath, onToggle }) => {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [logoPath]);

  if (imgFailed) {
    return (
      <SidebarExpandToggle
        surface="flush"
        onToggle={onToggle}
        className="sidebar-icon-col-geometry"
      />
    );
  }

  return (
    // A named group: the primitive passes no pointer handlers through, and an
    // unnamed one would fire on any ancestor that happens to be a `group`.
    <SidebarExpandToggle
      surface="flush"
      onToggle={onToggle}
      className="group/logo sidebar-icon-col-geometry sidebar-icon-col-geometry-logo relative"
    >
      <img
        src={logoPath}
        alt={t`Logo`}
        className="max-h-8 max-w-8 transition-opacity group-hover/logo:opacity-30"
        onError={() => setImgFailed(true)}
      />
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/logo:opacity-100">
        {/* Load-bearing: the geometry probe aligns the rail on the button's
            first aria-hidden node, and the badge is aria-hidden too. */}
        <SidebarToggleIcon aria-hidden="true" className="size-5" />
      </div>
    </SidebarExpandToggle>
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
    <SidebarBand edge="header">
      {/* In slim mode, show logo with hover toggle or just toggle button */}
      {isSlimMode && (
        <div className="flex w-full items-center">
          {sidebarLogoPath ? (
            <SidebarLogo
              logoPath={sidebarLogoPath}
              onToggle={onToggleCollapse}
            />
          ) : (
            <SidebarExpandToggle
              surface="flush"
              onToggle={onToggleCollapse}
              className="sidebar-icon-col-geometry"
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
            "flex w-full items-center transition-opacity duration-300",
            collapsed ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          <SidebarToggle
            surface="flush"
            expanded
            onClick={onToggleCollapse}
            label={t`collapse sidebar`}
            className="sidebar-icon-col-geometry"
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
    </SidebarBand>
  ),
);

// eslint-disable-next-line lingui/no-unlocalized-strings
ChatHistoryHeader.displayName = "ChatHistoryHeader";

/** Exported for the add-in's history drawer, which renders the same row. */
export const NewChatItem = memo<{
  onNewChat?: () => void;
  isSlimMode?: boolean;
}>(({ onNewChat, isSlimMode = false }) => {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal theme icon identifiers, not user-facing text
  const newChatIconId = useThemedIcon("navigation", "newChat");

  return (
    <SidebarNavigationItem
      label={t`New Chat`}
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal route path
      href="/chat/new"
      data-ui="sidebar-new-chat-item"
      icon={
        <ResolvedIcon
          iconId={newChatIconId}
          fallbackIcon={PlusIcon}
          className={sidebarNavigationIconClassName}
        />
      }
      isSlimMode={isSlimMode}
      onClick={() => {
        logger.log("[CHAT_FLOW] New chat item clicked");
        onNewChat?.();
      }}
    />
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
    <SidebarNavigationItem
      label={t`Search`}
      icon={
        <ResolvedIcon
          iconId={searchIconId}
          fallbackIcon={SearchIcon}
          className={sidebarNavigationIconClassName}
        />
      }
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal route path
      href="/search"
      active={isOnSearchPage}
      isSlimMode={isSlimMode}
      onClick={() => {
        logger.log("[CHAT_FLOW] Search navigation item clicked");
        onSearch?.();
      }}
      data-ui="sidebar-search-item"
    />
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
    <SidebarNavigationItem
      label={t`Assistants`}
      icon={
        <ResolvedIcon
          iconId={assistantsIconId}
          fallbackIcon={EditIcon}
          className={sidebarNavigationIconClassName}
        />
      }
      href={href}
      active={isOnAssistantsPage}
      isSlimMode={isSlimMode}
      onClick={() => {
        logger.log("[ASSISTANTS_FLOW] Assistants navigation item clicked");
        onAssistants?.();
      }}
      data-ui="sidebar-assistants-item"
    />
  );
});

// eslint-disable-next-line lingui/no-unlocalized-strings
AssistantsNavigationItem.displayName = "AssistantsNavigationItem";

const ScheduledNavigationItem = memo<{
  onScheduled?: () => void;
  isOnScheduledPage?: boolean;
  isSlimMode?: boolean;
}>(({ onScheduled, isOnScheduledPage, isSlimMode = false }) => {
  const scheduledIconId = useThemedIcon("navigation", "scheduled");
  const failureAlertShown = useScheduledFailureAlertShown();

  return (
    <SidebarNavigationItem
      label={t({ id: "scheduled.navigation.label", message: "Scheduled" })}
      warning={
        failureAlertShown
          ? t({
              id: "scheduled.navigation.failed",
              message: "something could not be carried out",
            })
          : undefined
      }
      icon={
        <ResolvedIcon
          iconId={scheduledIconId}
          fallbackIcon={CalendarIcon}
          className={sidebarNavigationIconClassName}
        />
      }
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal route path
      href="/scheduled"
      active={isOnScheduledPage}
      isSlimMode={isSlimMode}
      onClick={() => onScheduled?.()}
      data-ui="sidebar-scheduled-item"
    />
  );
});

// eslint-disable-next-line lingui/no-unlocalized-strings
ScheduledNavigationItem.displayName = "ScheduledNavigationItem";

const ChatHistoryFooter = memo<{
  userProfile?: UserProfile;
  onSignOut: () => void;
  isSlimMode?: boolean;
}>(({ userProfile, onSignOut }) => (
  <SidebarBand edge="footer" className="items-center">
    {/* The trigger's rail-column margin holds in both modes, so the slim
        rail needs no extra centering here. */}
    <UserProfileThemeDropdown
      userProfile={userProfile}
      onSignOut={onSignOut}
      className="flex w-full items-center"
    />
  </SidebarBand>
));

// eslint-disable-next-line lingui/no-unlocalized-strings
ChatHistoryFooter.displayName = "ChatHistoryFooter";

/** Exported for the add-in's history drawer, which shows the same row. */
export const NoFilterMatchesRow = () => (
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
    onNewChat,
    onToggleCollapse,
    showTitle = false,
    showTimestamps = true,
    sessions,
    currentSessionId,
    onSessionSelect,
    onSessionArchive,
    onSessionUnarchive,
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
    pageRef,
  }) => {
    const ref = useRef<HTMLElement>(null);
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
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal route path
    const scheduledRoute = "/scheduled";
    const isOnScheduledPage = location.pathname.startsWith(scheduledRoute);
    const { enabled: scheduledEnabled } = useScheduledFeature();

    // Get sidebar configuration
    // Logo env overrides are resolved by ThemeProvider, which also decides
    // whether the file exists; only the collapse mode is read here.
    const { collapsedMode, chatHistorySources, chatHistoryFiltersEnabled } =
      useSidebarFeature();

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

    // On a narrow screen the open sidebar pushes the page aside; after a
    // pick in it the person wants to see where they went.
    const isNarrowScreen = useIsNarrowScreen();
    const isDrawerOpen = useSidebarPushesPage(collapsed);
    const closeDrawerAfterPick = useCallback(() => {
      if (isDrawerOpen) {
        onToggleCollapse?.();
      }
    }, [isDrawerOpen, onToggleCollapse]);

    // Closing from beside the drawer or by Escape: focus inside the drawer
    // would stay on a control that has slid out of view, so it goes to the
    // control that opens the drawer again.
    const expandToggleRef = useRef<HTMLButtonElement>(null);
    const returnFocusOnHideRef = useRef(false);
    const dismissDrawer = useCallback(() => {
      returnFocusOnHideRef.current = Boolean(
        ref.current?.contains(document.activeElement),
      );
      onToggleCollapse?.();
    }, [onToggleCollapse]);
    // Phone browsers keep the left edge for their own back swipe; a host app
    // can hand it to the page, and then a drag from it opens the drawer.
    const [edgeShell] = useState(() =>
      hostShellWithCapability(LEFT_EDGE_SWIPE_CAPABILITY, 1),
    );
    const drawerEdgeShell =
      isNarrowScreen && onToggleCollapse ? edgeShell : null;
    const edgeOpensDrawer = drawerEdgeShell !== null;
    useEffect(
      () => (drawerEdgeShell ? claimLeftEdge(drawerEdgeShell) : undefined),
      [drawerEdgeShell],
    );
    const scrimRef = useRef<HTMLDivElement>(null);
    const edgeRef = useRef<HTMLDivElement>(null);
    const openDrawer = useCallback(
      () => onToggleCollapse?.(),
      [onToggleCollapse],
    );
    useSidebarDrawerSwipe({
      enabled: isNarrowScreen && Boolean(onToggleCollapse),
      isOpen: isDrawerOpen,
      drawerRef: ref,
      scrimRef,
      edgeRef,
      pageRef,
      onOpen: openDrawer,
      onClose: dismissDrawer,
    });
    useEffect(() => {
      if (isHiddenMode && returnFocusOnHideRef.current) {
        returnFocusOnHideRef.current = false;
        expandToggleRef.current?.focus();
      }
    }, [isHiddenMode]);
    useEffect(() => {
      if (!isDrawerOpen) {
        return;
      }
      const handleKeyDown = (event: KeyboardEvent) => {
        if (
          event.key !== "Escape" ||
          event.defaultPrevented ||
          isImeComposing(event)
        ) {
          return;
        }
        // A menu or dialog over the drawer takes its Escape first; its own
        // document listener may run after this one.
        if (
          event.target instanceof Element &&
          event.target.closest(
            '[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]',
          )
        ) {
          return;
        }
        dismissDrawer();
      };
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isDrawerOpen, dismissDrawer]);
    const handleNewChatPick = useCallback(() => {
      onNewChat?.();
      closeDrawerAfterPick();
    }, [onNewChat, closeDrawerAfterPick]);
    const handleSessionPick = useCallback(
      (sessionId: string) => {
        onSessionSelect(sessionId);
        closeDrawerAfterPick();
      },
      [onSessionSelect, closeDrawerAfterPick],
    );

    // Get theme information
    const { assetPaths } = useTheme();
    const sidebarLogoPath = assetPaths.sidebarLogo;

    // Apply any user-dragged sidebar width as the width-token override.
    useApplySidebarWidth();

    // Get assistants feature flag
    const {
      enabled: assistantsEnabled,
      delegationEnabled,
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

    const filterCapabilities = {
      enabled: chatHistoryFiltersEnabled,
      assistantsEnabled,
      delegationEnabled,
      availableSources: chatHistorySources,
    };
    useChatHistoryFilterFoldback(filterCapabilities);

    const chatHistoryFilters =
      useSanitizedChatHistoryFilters(filterCapabilities);
    const filterMenu = chatHistoryFiltersEnabled ? (
      <ChatHistoryFilterMenu
        assistantsEnabled={assistantsEnabled}
        delegationEnabled={delegationEnabled}
        availableSources={chatHistorySources}
      />
    ) : undefined;
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
    const recentChatGroups = useGroupedChatSessions(
      sessions,
      chatHistoryFilters.groupBy,
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

    const isLoadMorePaused = useGroupedLoadMorePaused(
      recentChatGroups,
      collapsedGroupKeys,
      isLoadingMoreSessions,
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
    // Delegated runs and chats hidden by filters may have no listing row.
    // Fetch their own details so a direct link still gets a browser title.
    const { data: currentChatDetail } = useChatDetail(
      currentSessionId && !currentSession
        ? { pathParams: { chatId: currentSessionId } }
        : skipToken,
    );
    const rawCurrentTitle =
      currentSession?.titleResolved ??
      currentSession?.title ??
      currentChatDetail?.title_resolved;
    const currentSessionTitle =
      rawCurrentTitle && rawCurrentTitle !== UNTITLED_BACKEND_SENTINEL
        ? rawCurrentTitle
        : (currentTitleHint ?? rawCurrentTitle);

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
      closeDrawerAfterPick();
    }, [navigate, closeDrawerAfterPick]);

    const handleAssistantsClick = useCallback(() => {
      logger.log("[ASSISTANTS_FLOW] Navigating to assistants page");
      navigate(assistantsLandingRoute);
      closeDrawerAfterPick();
    }, [assistantsLandingRoute, navigate, closeDrawerAfterPick]);

    const handleScheduledClick = useCallback(() => {
      navigate(scheduledRoute);
      closeDrawerAfterPick();
    }, [navigate, closeDrawerAfterPick]);

    const handleRecentAssistantPick = useCallback(
      (assistantId: string) => {
        navigate(getAssistantUrl(assistantId));
        closeDrawerAfterPick();
      },
      [navigate, closeDrawerAfterPick],
    );

    // Width is runtime state (slim vs expanded); the surface lives in
    // .sidebar-skin so [data-ui="sidebar"] stays themeable. The override
    // variable carries a user-dragged width; the theme token stays untouched
    // because the theme pipeline clears root inline values for every
    // --theme-* variable when it applies.
    const sidebarShellStyle = useMemo(
      () => ({
        width: isSlimMode
          ? "var(--theme-layout-sidebar-slim-width)"
          : "var(--sidebar-width-override, var(--theme-layout-sidebar-width))",
        // A large text size scales the rem width past a narrow screen; a
        // strip beside the drawer stays to tap it closed.
        maxWidth: "calc(100vw - 3rem)",
      }),
      [isSlimMode],
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
          {edgeOpensDrawer && (
            <div
              ref={edgeRef}
              aria-hidden="true"
              className={clsx(
                "viewport-layer fixed inset-y-0 left-0 z-30 w-[calc(var(--safe-area-left,0px)+20px)] touch-none",
                !isHiddenMode && "pointer-events-none",
              )}
              data-ui="sidebar-edge"
              data-testid="sidebar-edge"
            />
          )}
          {/* Placement stays here: the add-in's floating trigger disagrees
              about the z-index. */}
          {isHiddenMode && (
            <SidebarExpandToggle
              ref={expandToggleRef}
              surface="floating"
              onToggle={onToggleCollapse}
              className="absolute left-2 top-2 z-30 touch-phone:left-[var(--phone-edge-inset)]"
            />
          )}

          {/* On a narrow screen the open sidebar pushes the page aside, and
              this dims what stays in view of it. A tap there lands here and
              only closes the sidebar; the control underneath never gets that
              tap. */}
          {isNarrowScreen && (
            <div
              ref={scrimRef}
              role="presentation"
              // A press here would otherwise blur the focused control before
              // the click, and dismissDrawer could no longer see that focus
              // was in the drawer.
              onMouseDown={(event) => event.preventDefault()}
              onClick={dismissDrawer}
              className={clsx(
                "drawer-overlay-skin viewport-layer fixed inset-0 z-40 touch-pan-y",
                ERATO_GEOMETRY_CLASS.sidebarPageGeometry,
                "transition-[opacity,transform] duration-300 ease-in-out motion-reduce:transition-none",
                isDrawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
              )}
              data-sidebar-pushed={isDrawerOpen ? "" : undefined}
              data-ui="sidebar-scrim"
              data-testid="sidebar-scrim"
            />
          )}

          <aside
            ref={ref}
            className={clsx(
              "flex h-full flex-col border-r",
              // Fixed, so the app's safe-area padding does not reach it. It
              // starts beside the left inset, where the page's margin for it
              // starts too.
              "viewport-layer fixed inset-y-0 left-[var(--safe-area-left)] z-40",
              // A sideways drag stays the drawer's to cancel; see
              // useSidebarDrawerSwipe.
              isNarrowScreen && "touch-pan-y",
              "pb-[var(--safe-area-bottom)] pt-[var(--safe-area-top)]",
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
              <NewChatItem
                onNewChat={handleNewChatPick}
                isSlimMode={isSlimMode}
              />

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

              {scheduledEnabled && (
                <ScheduledNavigationItem
                  onScheduled={handleScheduledClick}
                  isOnScheduledPage={isOnScheduledPage}
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
                      onAssistantSelect={handleRecentAssistantPick}
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
                      onAssistantSelect={handleRecentAssistantPick}
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
                          onSessionSelect={handleSessionPick}
                          onSessionArchive={onSessionArchive}
                          onSessionUnarchive={onSessionUnarchive}
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
                        actions={filterMenu}
                      >
                        {sessions.length === 0 &&
                        hasActiveFilters(chatHistoryFilters) ? (
                          <NoFilterMatchesRow />
                        ) : (
                          <ResolvedChatHistoryList
                            sessions={sessions}
                            currentSessionId={currentSessionId}
                            onSessionSelect={handleSessionPick}
                            onSessionArchive={onSessionArchive}
                            onSessionUnarchive={onSessionUnarchive}
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
                            "sidebar-trailing-col-geometry flex items-center justify-end py-1",
                          )}
                          data-ui="chat-history-filter-row"
                        >
                          {filterMenu}
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
                          group.key === lastExpandedGroupKey &&
                          !isLoadMorePaused;
                        return (
                          <div key={group.key} data-ui="chat-history-group">
                            <CollapsibleSection
                              title={group.label ?? ""}
                              expanded={!collapsedGroupKeys.has(group.key)}
                              onExpandedChange={(expanded) =>
                                setGroupExpanded(group.key, expanded)
                              }
                              actions={index === 0 ? filterMenu : undefined}
                            >
                              <ResolvedChatHistoryList
                                sessions={group.sessions}
                                currentSessionId={currentSessionId}
                                onSessionSelect={handleSessionPick}
                                onSessionArchive={onSessionArchive}
                                onSessionUnarchive={onSessionUnarchive}
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
