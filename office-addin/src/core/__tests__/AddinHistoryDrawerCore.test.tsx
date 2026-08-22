import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddinHistoryDrawerCore } from "../AddinHistoryDrawerCore";
import { AddinHistoryFilterStoreContext } from "../addinChatHistoryFilterStore";

import type { ChatHistoryFilterStoreHook } from "@erato/frontend/library";
import type { ReactNode } from "react";

const spies = vi.hoisted(() => {
  const filterMenuStore: { current: unknown } = { current: null };
  return {
    navigateToChat: vi.fn(),
    createNewChat: vi.fn(async () => "temp"),
    archiveChat: vi.fn(async () => undefined),
    updateChatTitle: vi.fn(async () => undefined),
    fetchNextHistoryPage: vi.fn(async () => undefined),
    chatContext: {
      chats: [] as { id: string }[],
      isLoading: false,
      currentChatId: null as string | null,
      hasNextHistoryPage: false,
      isFetchingNextHistoryPage: false,
    },
    filters: {
      typeFilter: "all",
      statusFilter: "active",
      groupBy: "date",
    },
    historyListProps: [] as Array<{
      sessions: { id: string }[];
      hasMore?: boolean;
      onLoadMore?: () => void;
      onSessionSelect: (id: string) => void;
      onSessionEditTitle?: (id: string) => void;
      onSessionShare?: (id: string) => void;
    }>,
    renameDialogProps: {
      current: null as { isOpen: boolean; generatedTitle: string } | null,
    },
    filterMenuStore,
    sharingEnabled: { current: true },
  };
});

vi.mock("@erato/frontend/library", () => ({
  Button: ({
    icon: _icon,
    ...props
  }: Record<string, unknown> & { icon?: ReactNode }) => <button {...props} />,
  ChatHistoryFilterMenu: ({ store }: { store: unknown }) => {
    spies.filterMenuStore.current = store;
    return <div data-testid="filter-menu" />;
  },
  ChatHistoryList: (props: (typeof spies.historyListProps)[number]) => {
    spies.historyListProps.push(props);
    return (
      <div data-testid="history-list">
        {props.sessions.map((session) => (
          <div key={session.id}>
            <button
              type="button"
              data-testid={`row-${session.id}`}
              onClick={() => props.onSessionSelect(session.id)}
            />
            <button
              type="button"
              data-testid={`rename-${session.id}`}
              onClick={() => props.onSessionEditTitle?.(session.id)}
            />
          </div>
        ))}
        {props.hasMore ? (
          <button
            type="button"
            data-testid="load-more"
            onClick={() => props.onLoadMore?.()}
          />
        ) : null}
      </div>
    );
  },
  ChatHistoryListSkeleton: () => <div data-testid="chat-history-skeleton" />,
  ChatShareDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="share-dialog" /> : null,
  NewChatItem: ({ onNewChat }: { onNewChat?: () => void }) => (
    <button
      type="button"
      data-testid="new-chat-item"
      onClick={() => onNewChat?.()}
    />
  ),
  NoFilterMatchesRow: () => <p data-testid="chat-history-no-filter-matches" />,
  sidebarInsetClassName: "sidebar-inset-geometry",
  SettingsIcon: () => null,
  SidebarCollapsibleSection: ({
    title,
    actions,
    children,
  }: {
    title: string;
    actions?: ReactNode;
    children: ReactNode;
  }) => (
    <div data-testid="collapsible-section" data-title={title}>
      {actions}
      {children}
    </div>
  ),
  SidebarNavigationItem: ({
    label,
    onClick,
    "data-ui": dataUi,
  }: {
    label: string;
    onClick?: () => void;
    "data-ui"?: string;
  }) => (
    <button type="button" data-testid={dataUi} onClick={() => onClick?.()}>
      {label}
    </button>
  ),
  SidebarToggleIcon: () => null,
  EditChatTitleDialog: (props: { isOpen: boolean; generatedTitle: string }) => {
    spies.renameDialogProps.current = props;
    return props.isOpen ? <div data-testid="rename-dialog" /> : null;
  },
  hasActiveFilters: (values: { typeFilter: string; statusFilter: string }) =>
    values.typeFilter !== "all" || values.statusFilter !== "active",
  mapRecentChatToSession: (chat: { id: string }) => ({ id: chat.id }),
  sidebarNavigationIconClassName: "",
  useAssistantsFeature: () => ({ enabled: true }),
  useChatContext: () => ({
    ...spies.chatContext,
    navigateToChat: spies.navigateToChat,
    createNewChat: spies.createNewChat,
    archiveChat: spies.archiveChat,
    updateChatTitle: spies.updateChatTitle,
    fetchNextHistoryPage: spies.fetchNextHistoryPage,
  }),
  useChatSharingFeature: () => ({ enabled: spies.sharingEnabled.current }),
  useGroupedChatSessions: (sessions: { id: string }[]) =>
    sessions.length === 0
      ? []
      : [
          { key: "a", label: "Group A", sessions: sessions.slice(0, 1) },
          { key: "b", label: "Group B", sessions: sessions.slice(1) },
        ].filter((group) => group.sessions.length > 0),
  useSanitizedChatHistoryFilters: () => spies.filters,
}));

const fakeFilterStore = (() =>
  undefined) as unknown as ChatHistoryFilterStoreHook;

const renderDrawer = (
  overrides: Partial<
    Pick<
      Parameters<typeof AddinHistoryDrawerCore>[0],
      "isOpen" | "onClose" | "onOpenSettings" | "sectionsBeforeHistory"
    >
  > = {},
) => {
  const onClose = overrides.onClose ?? vi.fn();
  const onOpenSettings = overrides.onOpenSettings ?? vi.fn();
  const view = render(
    <AddinHistoryFilterStoreContext.Provider value={fakeFilterStore}>
      <AddinHistoryDrawerCore
        isOpen={overrides.isOpen ?? true}
        onClose={onClose}
        onOpenSettings={onOpenSettings}
        panelId="drawer-panel"
        sectionsBeforeHistory={overrides.sectionsBeforeHistory}
      />
    </AddinHistoryFilterStoreContext.Provider>,
  );
  return { onClose, onOpenSettings, ...view };
};

describe("AddinHistoryDrawerCore", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    i18n.activate("en");
    vi.clearAllMocks();
    spies.historyListProps.length = 0;
    spies.renameDialogProps.current = null;
    spies.filterMenuStore.current = null;
    spies.sharingEnabled.current = true;
    spies.chatContext.chats = [{ id: "c1" }, { id: "c2" }];
    spies.chatContext.isLoading = false;
    spies.chatContext.hasNextHistoryPage = false;
    spies.filters = {
      typeFilter: "all",
      statusFilter: "active",
      groupBy: "date",
    };
  });

  it("renders nothing while closed", () => {
    renderDrawer({ isOpen: false });
    expect(screen.queryByTestId("addin-history-drawer")).toBeNull();
  });

  it("selects a row through the session path and closes", () => {
    const { onClose } = renderDrawer();

    fireEvent.click(screen.getByTestId("row-c1"));

    expect(spies.navigateToChat).toHaveBeenCalledWith("c1");
    expect(onClose).toHaveBeenCalled();
  });

  it("puts the pagination sentinel on the last group only", () => {
    spies.chatContext.hasNextHistoryPage = true;
    renderDrawer();

    expect(spies.historyListProps).toHaveLength(2);
    expect(spies.historyListProps[0]?.hasMore).toBe(false);
    expect(spies.historyListProps[1]?.hasMore).toBe(true);

    fireEvent.click(screen.getByTestId("load-more"));
    expect(spies.fetchNextHistoryPage).toHaveBeenCalled();
  });

  it("closes on an element-scoped Escape", () => {
    const { onClose } = renderDrawer();

    fireEvent.keyDown(screen.getByTestId("addin-history-drawer"), {
      key: "Escape",
    });

    expect(onClose).toHaveBeenCalled();
  });

  // Portalled popover content (the filter menu, row menus) lives under
  // document.body in the DOM but inside the panel in the React tree, so its
  // keydowns re-enter the panel handler. The handler must leave those events
  // alone — the popovers close themselves through document-level listeners
  // that its stopPropagation would otherwise starve. The portal here stands
  // in for a real popover: same React parentage, same out-of-panel DOM
  // target, so the guard is exercised through the genuine event path.
  it("ignores Escape arriving from portalled popover content", () => {
    const { onClose } = renderDrawer({
      sectionsBeforeHistory: createPortal(
        <button type="button" data-testid="portalled-popover-content" />,
        document.body,
      ),
    });

    fireEvent.keyDown(screen.getByTestId("portalled-popover-content"), {
      key: "Escape",
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByTestId("addin-history-drawer"), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes only when the backdrop element itself is clicked", () => {
    const { onClose } = renderDrawer();

    fireEvent.click(screen.getByTestId("addin-history-drawer"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("addin-history-drawer-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts a new chat and closes", () => {
    const { onClose } = renderDrawer();

    fireEvent.click(screen.getByTestId("new-chat-item"));

    expect(spies.createNewChat).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("opens settings after closing itself", () => {
    const { onClose, onOpenSettings } = renderDrawer();

    fireEvent.click(screen.getByTestId("addin-history-drawer-settings"));

    expect(onClose).toHaveBeenCalled();
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("hands the platform's filter store to the filter menu", () => {
    renderDrawer();
    expect(spies.filterMenuStore.current).toBe(fakeFilterStore);
  });

  it("withholds the share action when sharing is disabled", () => {
    spies.sharingEnabled.current = false;
    renderDrawer();
    expect(spies.historyListProps[0]?.onSessionShare).toBeUndefined();
  });

  it("mounts off-screen and slides in one frame later", () => {
    vi.useFakeTimers();
    try {
      renderDrawer();

      const panel = screen.getByTestId("addin-history-drawer");
      expect(panel.className).toContain("-translate-x-full");

      // Two animation frames flip the visual state so the slide has a
      // painted start frame.
      act(() => {
        vi.advanceTimersByTime(64);
      });
      expect(panel.className).toContain(" translate-x-0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays mounted through the exit slide, then unmounts on the backstop", () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      const drawerAt = (isOpen: boolean) => (
        <AddinHistoryFilterStoreContext.Provider value={fakeFilterStore}>
          <AddinHistoryDrawerCore
            isOpen={isOpen}
            onClose={onClose}
            onOpenSettings={vi.fn()}
            panelId="drawer-panel"
          />
        </AddinHistoryFilterStoreContext.Provider>
      );
      const { rerender } = render(drawerAt(true));
      act(() => {
        vi.advanceTimersByTime(64);
      });

      rerender(drawerAt(false));
      // Exit phase: still in the DOM, translated away, scrim click-through.
      const panel = screen.getByTestId("addin-history-drawer");
      expect(panel.className).toContain("-translate-x-full");
      expect(
        screen.getByTestId("addin-history-drawer-backdrop").className,
      ).toContain("pointer-events-none");

      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.queryByTestId("addin-history-drawer")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // Regression: the panel mounts a commit after `isOpen` flips, so a focus
  // effect keyed on the open state alone ran against a null ref and keyboard
  // users never entered the panel.
  it("moves focus into the panel when opened from closed", () => {
    vi.useFakeTimers();
    try {
      const drawerAt = (isOpen: boolean) => (
        <AddinHistoryFilterStoreContext.Provider value={fakeFilterStore}>
          <AddinHistoryDrawerCore
            isOpen={isOpen}
            onClose={vi.fn()}
            onOpenSettings={vi.fn()}
            panelId="drawer-panel"
          />
        </AddinHistoryFilterStoreContext.Provider>
      );
      const { rerender } = render(drawerAt(false));
      expect(screen.queryByTestId("addin-history-drawer")).toBeNull();

      rerender(drawerAt(true));
      act(() => {
        vi.advanceTimersByTime(64);
      });

      const panel = screen.getByTestId("addin-history-drawer");
      expect(panel.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toBe(
        screen.getByTestId("addin-history-drawer-close"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("disarms open dialogs when the drawer closes", () => {
    vi.useFakeTimers();
    try {
      const drawerAt = (isOpen: boolean) => (
        <AddinHistoryFilterStoreContext.Provider value={fakeFilterStore}>
          <AddinHistoryDrawerCore
            isOpen={isOpen}
            onClose={vi.fn()}
            onOpenSettings={vi.fn()}
            panelId="drawer-panel"
          />
        </AddinHistoryFilterStoreContext.Provider>
      );
      const { rerender } = render(drawerAt(true));
      act(() => {
        vi.advanceTimersByTime(64);
      });

      fireEvent.click(screen.getByTestId("rename-c1"));
      expect(screen.getByTestId("rename-dialog")).toBeInTheDocument();

      rerender(drawerAt(false));
      act(() => {
        vi.advanceTimersByTime(300);
      });
      rerender(drawerAt(true));
      act(() => {
        vi.advanceTimersByTime(64);
      });
      expect(screen.queryByTestId("rename-dialog")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves the generated-title fallback to the rename dialog", () => {
    renderDrawer();

    fireEvent.click(screen.getByTestId("rename-c1"));

    expect(spies.renameDialogProps.current?.isOpen).toBe(true);
    expect(spies.renameDialogProps.current?.generatedTitle).toBe("");
  });

  it("shows the history skeleton while the first page loads", () => {
    spies.chatContext.chats = [];
    spies.chatContext.isLoading = true;
    renderDrawer();

    expect(screen.getByTestId("chat-history-skeleton")).toBeInTheDocument();
  });

  it("shows an empty-state row when there are no chats at all", () => {
    spies.chatContext.chats = [];
    renderDrawer();

    expect(
      screen.getByTestId("addin-history-drawer-empty"),
    ).toBeInTheDocument();
  });

  it("says when active filters match nothing instead of showing an empty void", () => {
    spies.chatContext.chats = [];
    spies.filters = {
      typeFilter: "assistant",
      statusFilter: "active",
      groupBy: "date",
    };
    renderDrawer();

    expect(
      screen.getByTestId("chat-history-no-filter-matches"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("addin-history-drawer-empty")).toBeNull();
  });
});
