import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
      onSessionShare?: (id: string) => void;
    }>,
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
          <button
            key={session.id}
            type="button"
            data-testid={`row-${session.id}`}
            onClick={() => props.onSessionSelect(session.id)}
          />
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
  ChatShareDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="share-dialog" /> : null,
  CloseIcon: () => null,
  EditChatTitleDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="rename-dialog" /> : null,
  groupChatSessions: (sessions: { id: string }[]) =>
    sessions.length === 0
      ? []
      : [
          { key: "a", label: "Group A", sessions: sessions.slice(0, 1) },
          { key: "b", label: "Group B", sessions: sessions.slice(1) },
        ].filter((group) => group.sessions.length > 0),
  hasActiveFilters: (values: { typeFilter: string; statusFilter: string }) =>
    values.typeFilter !== "all" || values.statusFilter !== "active",
  mapRecentChatToSession: (chat: { id: string }) => ({ id: chat.id }),
  resolveChatAttentionStatus: () => null,
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
  useConfirmationRegistryStore: (
    selector: (state: {
      pendingIdsByChatId: Record<string, string[]>;
    }) => unknown,
  ) => selector({ pendingIdsByChatId: {} }),
  useGenerationStatusStore: (
    selector: (state: { statusByChatId: Record<string, unknown> }) => unknown,
  ) => selector({ statusByChatId: {} }),
  useLingui: () => ({ i18n: { locale: "en" } }),
  useSanitizedChatHistoryFilters: () => spies.filters,
}));

const fakeFilterStore = (() =>
  undefined) as unknown as ChatHistoryFilterStoreHook;

const renderDrawer = (
  overrides: Partial<
    Pick<
      Parameters<typeof AddinHistoryDrawerCore>[0],
      "isOpen" | "onClose" | "onOpenSettings"
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

  it("closes only when the backdrop element itself is clicked", () => {
    const { onClose } = renderDrawer();

    fireEvent.click(screen.getByTestId("addin-history-drawer"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("addin-history-drawer-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("starts a new chat and closes", () => {
    const { onClose } = renderDrawer();

    fireEvent.click(screen.getByTestId("addin-history-drawer-new-chat"));

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

  it("says when active filters match nothing instead of showing an empty void", () => {
    spies.chatContext.chats = [];
    spies.filters = {
      typeFilter: "assistant",
      statusFilter: "active",
      groupBy: "date",
    };
    renderDrawer();

    expect(
      screen.getByTestId("addin-history-drawer-empty"),
    ).toBeInTheDocument();
  });
});
