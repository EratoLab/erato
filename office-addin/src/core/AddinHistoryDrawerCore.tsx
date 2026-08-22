import {
  Button,
  ChatHistoryFilterMenu,
  ChatHistoryList,
  ChatHistoryListSkeleton,
  ChatShareDialog,
  EditChatTitleDialog,
  NewChatItem,
  NoFilterMatchesRow,
  SettingsIcon,
  sidebarInsetClassName,
  SidebarCollapsibleSection,
  SidebarNavigationItem,
  SidebarToggleIcon,
  hasActiveFilters,
  mapRecentChatToSession,
  sidebarNavigationIconClassName,
  useAssistantsFeature,
  useChatContext,
  useChatSharingFeature,
  useGroupedChatSessions,
  useSanitizedChatHistoryFilters,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAddinHistoryFilterStore } from "./addinChatHistoryFilterStore";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Unmount backstop for the exit slide: a backgrounded webview can swallow
 * `transitionend`, and reduced motion never fires one — an invisible drawer
 * must not stay mounted eating clicks. Just past the 150ms transition. */
const EXIT_FALLBACK_MS = 250;

export interface AddinHistoryDrawerCoreProps {
  isOpen: boolean;
  onClose: () => void;
  /** Opens the settings dialog owned by the chat surface. */
  onOpenSettings: () => void;
  /** Id the header trigger references via `aria-controls`. */
  panelId: string;
  /** Future sections (assistants row, search, delegated runs). */
  sectionsBeforeHistory?: ReactNode;
  sectionsAfterHistory?: ReactNode;
}

/**
 * The pane's menu: a left-anchored overlay drawer with New Chat, the
 * filterable chat history, and Settings. State-driven on purpose — the
 * add-in performs no router navigation, so opening it can never trip the
 * Outlook session policy; row selection goes through the same
 * `navigateToChat` → session-controller path as the ask-toast picker.
 */
export function AddinHistoryDrawerCore({
  isOpen,
  onClose,
  onOpenSettings,
  panelId,
  sectionsBeforeHistory,
  sectionsAfterHistory,
}: AddinHistoryDrawerCoreProps) {
  const chat = useChatContext();
  const filterStore = useAddinHistoryFilterStore();
  const { enabled: assistantsEnabled } = useAssistantsFeature();
  const filters = useSanitizedChatHistoryFilters(
    assistantsEnabled,
    filterStore,
  );
  const { enabled: sharingEnabled } = useChatSharingFeature();

  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Slide choreography: mounted through both slides, `isShown` drives the
  // transform/opacity pair (the only animated properties — both composite-
  // only, so the slide stays smooth in the Office webviews).
  const [isMounted, setIsMounted] = useState(isOpen);
  const [isShown, setIsShown] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsShown(false);
      return;
    }
    setIsMounted(true);
    // Two frames so the off-screen start state paints (and the list's heavy
    // first paint lands) before the slide begins.
    const second = { id: 0 };
    const first = window.requestAnimationFrame(() => {
      second.id = window.requestAnimationFrame(() => setIsShown(true));
    });
    return () => {
      window.cancelAnimationFrame(first);
      window.cancelAnimationFrame(second.id);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen || !isMounted) return;
    const panel = panelRef.current;
    const finish = () => setIsMounted(false);
    const fallback = window.setTimeout(finish, EXIT_FALLBACK_MS);
    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.target === panel && event.propertyName === "transform") {
        finish();
      }
    };
    panel?.addEventListener("transitionend", handleTransitionEnd);
    return () => {
      window.clearTimeout(fallback);
      panel?.removeEventListener("transitionend", handleTransitionEnd);
    };
  }, [isOpen, isMounted]);

  const [titleDialogSessionId, setTitleDialogSessionId] = useState<
    string | null
  >(null);
  const [shareDialogChatId, setShareDialogChatId] = useState<string | null>(
    null,
  );
  const [isUpdatingTitle, setIsUpdatingTitle] = useState(false);

  // A dialog left open when the drawer closes would otherwise survive the
  // unmount in this state and resurrect on the next open.
  useEffect(() => {
    if (isOpen) return;
    setTitleDialogSessionId(null);
    setShareDialogChatId(null);
  }, [isOpen]);

  const sessions = useMemo(
    () => (chat.chats ?? []).map(mapRecentChatToSession),
    [chat.chats],
  );

  const groups = useGroupedChatSessions(sessions, filters.groupBy);

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

  // The infinite-scroll sentinel must sit inside a visible list, so it
  // follows the last still-expanded group rather than simply the last one.
  // With every group collapsed there is no sentinel at all.
  const lastExpandedGroupKey = useMemo(
    () =>
      groups.findLast((group) => !collapsedGroupKeys.has(group.key))?.key ??
      null,
    [groups, collapsedGroupKeys],
  );

  // Focus moves into the panel on open and back to where it came from on
  // close, so the trigger keeps its place in the tab order. Gated on the
  // mount state: on open the panel is still unmounted in the commit that
  // flips `isOpen`, so focusing must wait for the commit that mounts it.
  useEffect(() => {
    if (!isOpen || !isMounted) return;
    const previouslyFocused = document.activeElement;
    toggleRef.current?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen, isMounted]);

  const handleSelect = useCallback(
    (sessionId: string) => {
      chat.navigateToChat(sessionId);
      onClose();
    },
    [chat, onClose],
  );

  const handleNewChat = useCallback(() => {
    void chat.createNewChat();
    onClose();
  }, [chat, onClose]);

  const handleSubmitTitle = useCallback(
    async (title: string) => {
      if (!titleDialogSessionId) return;
      setIsUpdatingTitle(true);
      try {
        await chat.updateChatTitle(titleDialogSessionId, title);
        setTitleDialogSessionId(null);
      } finally {
        setIsUpdatingTitle(false);
      }
    },
    [chat, titleDialogSessionId],
  );

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Popovers (the filter menu, row menus) portal their panels to
    // document.body but stay React-tree children of this panel, so their
    // keydowns bubble back through React into this handler. Their own close
    // handling listens on the document, which the stopPropagation below
    // would starve — one Escape would close the whole drawer instead of the
    // popover. An event whose DOM target is outside the panel belongs to
    // such a portalled layer and is not ours to handle.
    if (
      panelRef.current &&
      event.target instanceof Node &&
      !panelRef.current.contains(event.target)
    ) {
      return;
    }
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Only the backdrop element itself counts as outside: portalled popover
  // panels are DOM siblings of this overlay and must not close the drawer.
  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  if (!isMounted) {
    return null;
  }

  const activeTitleSession = titleDialogSessionId
    ? (sessions.find((session) => session.id === titleDialogSessionId) ?? null)
    : null;
  const isInitialLoading = chat.isLoading && sessions.length === 0;
  const showNoMatches =
    !chat.isLoading && sessions.length === 0 && hasActiveFilters(filters);
  const showEmpty =
    !chat.isLoading && sessions.length === 0 && !hasActiveFilters(filters);

  const filterMenu = (
    <ChatHistoryFilterMenu
      assistantsEnabled={assistantsEnabled}
      store={filterStore}
    />
  );
  const emptyRow = (
    <p
      className="sidebar-content-col-geometry py-2 pr-3 text-xs text-theme-fg-muted"
      data-testid="addin-history-drawer-empty"
    >
      {t({ id: "officeAddin.historyDrawer.empty", message: "No chats yet" })}
    </p>
  );
  const renderChatList = (
    groupSessions: typeof sessions,
    carriesLoadMore: boolean,
  ) => (
    <ChatHistoryList
      sessions={groupSessions}
      currentSessionId={chat.currentChatId}
      onSessionSelect={handleSelect}
      onSessionArchive={(sessionId) => void chat.archiveChat(sessionId)}
      onSessionEditTitle={setTitleDialogSessionId}
      onSessionShare={sharingEnabled ? setShareDialogChatId : undefined}
      hasMore={carriesLoadMore && chat.hasNextHistoryPage}
      isLoadingMore={carriesLoadMore ? chat.isFetchingNextHistoryPage : false}
      onLoadMore={
        carriesLoadMore ? () => void chat.fetchNextHistoryPage() : undefined
      }
    />
  );

  return (
    <>
      <div
        // No blur on purpose: a backdrop-filter re-evaluates under the
        // sliding panel every frame; the scrim fades on opacity alone.
        // pointer-events-none while hidden lets a click land on the pane the
        // instant the exit slide starts instead of dying on the scrim.
        className={`drawer-overlay-skin theme-transition fixed inset-0 z-50 ${
          isShown ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        role="presentation"
        onClick={handleBackdropClick}
        data-testid="addin-history-drawer-backdrop"
      >
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the dialog owns its element-scoped Escape and Tab-wrap handling */}
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-modal="true"
          aria-label={t({
            id: "officeAddin.historyDrawer.title",
            message: "Menu",
          })}
          onKeyDown={handlePanelKeyDown}
          className={`sidebar-skin theme-transition absolute inset-y-0 left-0 flex w-[min(320px,calc(100vw-48px))] flex-col motion-reduce:transition-none ${
            isShown ? "translate-x-0" : "-translate-x-full"
          }`}
          data-testid="addin-history-drawer"
          data-ui="addin-history-drawer"
        >
          {/* Same header anatomy as the web sidebar: the toggle sits where
              the floating trigger sat, so open/close reads as one control. */}
          <div
            className="sidebar-section-skin sidebar-band-geometry flex border-b"
            data-ui="sidebar-header"
          >
            <div className="flex w-full items-center">
              <Button
                ref={toggleRef}
                onClick={onClose}
                variant="sidebar-icon"
                icon={<SidebarToggleIcon />}
                className="sidebar-icon-col-geometry rotate-180"
                aria-label={t({
                  id: "officeAddin.historyDrawer.close",
                  message: "Close menu",
                })}
                aria-expanded="true"
                data-testid="addin-history-drawer-close"
              />
            </div>
          </div>

          <NewChatItem onNewChat={handleNewChat} />

          {sectionsBeforeHistory}

          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2"
            data-ui="addin-history-drawer-list"
          >
            {/* Same composition as the web sidebar: group sections are
                top-level SIBLINGS (never nested — a wrapper section would
                stack a second sidebar inset under theirs and shift every row
                off the rail column), with the filter menu riding the first
                group's actions slot. */}
            {isInitialLoading ? (
              <div className={sidebarInsetClassName}>
                <ChatHistoryListSkeleton />
              </div>
            ) : filters.groupBy === "none" ? (
              <SidebarCollapsibleSection
                title={t({ id: "chat.history.recent", message: "Recent" })}
                actions={filterMenu}
              >
                {showNoMatches ? (
                  <NoFilterMatchesRow />
                ) : showEmpty ? (
                  emptyRow
                ) : (
                  renderChatList(sessions, true)
                )}
              </SidebarCollapsibleSection>
            ) : groups.length === 0 ? (
              <>
                {/* No group headers exist to host the filter menu, so a bare
                    header row keeps its trigger reachable. */}
                <div
                  className={`${sidebarInsetClassName} sidebar-trailing-col-geometry flex items-center justify-end py-1`}
                  data-ui="chat-history-filter-row"
                >
                  {filterMenu}
                </div>
                {showNoMatches ? (
                  <div className={sidebarInsetClassName}>
                    <NoFilterMatchesRow />
                  </div>
                ) : showEmpty ? (
                  <div className={sidebarInsetClassName}>{emptyRow}</div>
                ) : null}
              </>
            ) : (
              groups.map((group, index) => {
                const carriesLoadMore = group.key === lastExpandedGroupKey;
                return (
                  <div key={group.key} data-ui="chat-history-group">
                    <SidebarCollapsibleSection
                      title={group.label ?? ""}
                      expanded={!collapsedGroupKeys.has(group.key)}
                      onExpandedChange={(expanded) =>
                        setGroupExpanded(group.key, expanded)
                      }
                      actions={index === 0 ? filterMenu : undefined}
                    >
                      {renderChatList(group.sessions, carriesLoadMore)}
                    </SidebarCollapsibleSection>
                  </div>
                );
              })
            )}
          </div>

          {sectionsAfterHistory}

          {/* !p-0: the nav row carries the sidebar inset channel itself, so
              the band's own padding must lose — and it needs the important
              modifier because the skin class shares specificity and comes
              later in the built stylesheet. */}
          <div
            className="sidebar-section-skin border-t !p-0"
            data-ui="sidebar-footer"
          >
            <SidebarNavigationItem
              label={t({
                id: "officeAddin.headerMenu.settings",
                message: "Settings",
              })}
              icon={<SettingsIcon className={sidebarNavigationIconClassName} />}
              onClick={() => {
                onClose();
                onOpenSettings();
              }}
              data-ui="addin-history-drawer-settings"
            />
          </div>
        </div>
      </div>

      <EditChatTitleDialog
        isOpen={activeTitleSession !== null}
        generatedTitle={activeTitleSession?.titleBySummary ?? ""}
        initialUserProvidedTitle={activeTitleSession?.titleByUserProvided}
        isSubmitting={isUpdatingTitle}
        onClose={() => setTitleDialogSessionId(null)}
        onSubmit={handleSubmitTitle}
      />
      <ChatShareDialog
        isOpen={shareDialogChatId !== null}
        chatId={shareDialogChatId}
        onClose={() => setShareDialogChatId(null)}
      />
    </>
  );
}
