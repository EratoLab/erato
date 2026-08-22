import {
  Button,
  ChatHistoryFilterMenu,
  ChatHistoryList,
  ChatShareDialog,
  CloseIcon,
  EditChatTitleDialog,
  groupChatSessions,
  hasActiveFilters,
  mapRecentChatToSession,
  resolveChatAttentionStatus,
  useAssistantsFeature,
  useChatContext,
  useChatSharingFeature,
  useConfirmationRegistryStore,
  useGenerationStatusStore,
  useLingui,
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
  const { i18n } = useLingui();

  const panelRef = useRef<HTMLDivElement>(null);
  const newChatRef = useRef<HTMLButtonElement>(null);

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

  const sessions = useMemo(
    () => (chat.chats ?? []).map(mapRecentChatToSession),
    [chat.chats],
  );

  const statusByChatId = useGenerationStatusStore(
    (state) => state.statusByChatId,
  );
  const pendingIdsByChatId = useConfirmationRegistryStore(
    (state) => state.pendingIdsByChatId,
  );
  const groups = useMemo(
    () =>
      groupChatSessions(sessions, filters.groupBy, {
        now: new Date(),
        locale: i18n.locale,
        needsAttention: (session) =>
          resolveChatAttentionStatus(
            statusByChatId[session.id],
            (pendingIdsByChatId[session.id]?.length ?? 0) > 0,
          ) !== null,
      }),
    [
      sessions,
      filters.groupBy,
      i18n.locale,
      statusByChatId,
      pendingIdsByChatId,
    ],
  );

  // Focus moves into the panel on open and back to where it came from on
  // close, so the trigger keeps its place in the tab order.
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement;
    newChatRef.current?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

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

  // Element-scoped on purpose: the filter menu's popover closes itself on a
  // document-level Escape without the event ever reaching this panel, so the
  // first Escape closes the menu and only the second closes the drawer.
  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
  const showNoMatches =
    sessions.length === 0 && !chat.isLoading && hasActiveFilters(filters);

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
          className={`theme-transition absolute inset-y-0 left-0 flex w-[min(320px,calc(100vw-48px))] flex-col bg-theme-bg-primary shadow-xl motion-reduce:transition-none ${
            isShown ? "translate-x-0" : "-translate-x-full"
          }`}
          data-testid="addin-history-drawer"
          data-ui="addin-history-drawer"
        >
          <div className="flex items-center justify-between border-b border-theme-border px-3 py-2">
            <span className="text-sm font-semibold text-theme-fg-primary">
              {t({ id: "officeAddin.historyDrawer.title", message: "Menu" })}
            </span>
            <Button
              variant="icon-only"
              size="sm"
              icon={<CloseIcon className="size-4" />}
              aria-label={t({
                id: "officeAddin.historyDrawer.close",
                message: "Close menu",
              })}
              onClick={onClose}
              data-testid="addin-history-drawer-close"
            />
          </div>

          <button
            ref={newChatRef}
            type="button"
            onClick={handleNewChat}
            className="focus-ring-inset theme-transition mx-1.5 mt-1.5 rounded-[var(--theme-radius-base)] px-2 py-2 text-left text-sm font-medium text-theme-fg-primary hover:bg-theme-bg-hover"
            data-testid="addin-history-drawer-new-chat"
          >
            {t({ id: "officeAddin.chat.newChat", message: "New Chat" })}
          </button>

          {sectionsBeforeHistory}

          <div className="flex items-center justify-between px-3 pt-2">
            <span className="text-xs font-semibold text-theme-fg-secondary">
              {t({ id: "officeAddin.historyDrawer.chats", message: "Chats" })}
            </span>
            <ChatHistoryFilterMenu
              assistantsEnabled={assistantsEnabled}
              store={filterStore}
            />
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2"
            data-ui="addin-history-drawer-list"
          >
            {showNoMatches ? (
              <p
                className="px-2 py-3 text-xs text-theme-fg-muted"
                data-testid="addin-history-drawer-empty"
              >
                {t({
                  id: "officeAddin.historyDrawer.noMatches",
                  message: "No chats match the current filters",
                })}
              </p>
            ) : (
              groups.map((group, index) => (
                <div key={group.key}>
                  {group.label ? (
                    <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-theme-fg-muted">
                      {group.label}
                    </p>
                  ) : null}
                  <ChatHistoryList
                    sessions={group.sessions}
                    currentSessionId={chat.currentChatId}
                    onSessionSelect={handleSelect}
                    onSessionArchive={(sessionId) =>
                      void chat.archiveChat(sessionId)
                    }
                    onSessionEditTitle={setTitleDialogSessionId}
                    onSessionShare={
                      sharingEnabled ? setShareDialogChatId : undefined
                    }
                    isLoading={chat.isLoading && sessions.length === 0}
                    hasMore={
                      index === groups.length - 1 && chat.hasNextHistoryPage
                    }
                    isLoadingMore={chat.isFetchingNextHistoryPage}
                    onLoadMore={() => void chat.fetchNextHistoryPage()}
                  />
                </div>
              ))
            )}
          </div>

          {sectionsAfterHistory}

          <div className="border-t border-theme-border p-1.5">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenSettings();
              }}
              className="focus-ring-inset theme-transition w-full rounded-[var(--theme-radius-base)] px-2 py-2 text-left text-sm text-theme-fg-primary hover:bg-theme-bg-hover"
              data-testid="addin-history-drawer-settings"
            >
              {t({
                id: "officeAddin.headerMenu.settings",
                message: "Settings",
              })}
            </button>
          </div>
        </div>
      </div>

      <EditChatTitleDialog
        isOpen={activeTitleSession !== null}
        generatedTitle={
          activeTitleSession?.titleBySummary ??
          t({
            id: "officeAddin.historyDrawer.rename.generated.fallback",
            message: "Untitled Chat",
          })
        }
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
