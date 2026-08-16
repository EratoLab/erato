import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { ChatHistorySidebar } from "./ChatHistorySidebar";

import type { ChatSession } from "@/types/chat";
import type { Messages } from "@lingui/core";

let mockedCollapsedMode = "hidden";
let mockedAssistantsEnabled = false;
let mockedAssistantHubEnabled = false;

vi.mock("@/components/providers/ThemeProvider", () => ({
  useTheme: () => ({
    effectiveTheme: "light",
    customThemeName: null,
  }),
}));

vi.mock("@/config/themeConfig", () => ({
  defaultThemeConfig: {
    getSidebarLogoPath: () => null,
  },
}));

vi.mock("@/hooks/ui", () => ({
  useResponsiveCollapsedMode: (mode: string) => mode,
  useThemedIcon: () => null,
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useAssistantHubConfig: () => ({
    data: { enabled: mockedAssistantHubEnabled },
  }),
}));

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useAssistantsFeature: () => ({
    enabled: mockedAssistantsEnabled,
    showRecentItems: false,
    showRecentItemsCollapsible: false,
  }),
  useSidebarFeature: () => ({
    collapsedMode: mockedCollapsedMode,
    logoPath: null,
    logoDarkPath: null,
  }),
}));

vi.mock("@/utils/themeUtils", () => ({
  checkFileExists: vi.fn(async () => false),
}));

const historyListProps = vi.hoisted(
  () => [] as { sessions: { id: string }[]; hasMore?: boolean }[],
);
vi.mock("./ChatHistoryList", () => ({
  ChatHistoryList: (props: {
    sessions: { id: string }[];
    hasMore?: boolean;
  }) => {
    historyListProps.push(props);
    return <div data-testid="history-list" />;
  },
  ChatHistoryListSkeleton: () => <div data-testid="history-skeleton" />,
}));

vi.mock("./FrequentAssistantsList", () => ({
  FrequentAssistantsList: () => null,
}));

vi.mock("../Controls/UserProfileThemeDropdown", () => ({
  UserProfileThemeDropdown: () => <div data-testid="profile-dropdown" />,
}));

const sessions: ChatSession[] = [
  {
    id: "chat-1",
    title: "First chat",
    messages: [],
    updatedAt: new Date("2024-01-01").toISOString(),
  },
];

describe("ChatHistorySidebar", () => {
  beforeEach(async () => {
    mockedCollapsedMode = "hidden";
    mockedAssistantsEnabled = false;
    mockedAssistantHubEnabled = false;
    localStorage.clear();
    historyListProps.length = 0;
    const { CHAT_HISTORY_FILTER_DEFAULTS, useChatHistoryFilterStore } =
      await import("@/hooks/chat/store/chatHistoryFilterStore");
    useChatHistoryFilterStore.setState({ ...CHAT_HISTORY_FILTER_DEFAULTS });
    const { i18n } = await import("@lingui/core");
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  it("uses the sidebar token surface for the shell", async () => {
    const { i18n } = await import("@lingui/core");
    const { container } = render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={sessions}
            currentSessionId="chat-1"
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            isLoading={false}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    const sidebar = container.querySelector('[data-ui="sidebar"]');

    // Surface from the class so theme.css can reach it; only the computed
    // width stays inline.
    expect(sidebar).toHaveClass("sidebar-skin");
    expect(sidebar).toHaveStyle({
      width: "var(--sidebar-width-override, var(--theme-layout-sidebar-width))",
    });
    for (const property of ["background-color", "box-shadow"]) {
      expect(sidebar?.getAttribute("style") ?? "").not.toContain(property);
    }
    expect(container.querySelector('[data-ui="sidebar-header"]')).toHaveClass(
      "sidebar-section-skin",
    );
    expect(container.querySelector('[data-ui="sidebar-footer"]')).toHaveClass(
      "sidebar-section-skin",
    );
    expect(screen.getByTestId("history-list")).toBeInTheDocument();
  });

  it("renders the active search nav item with the selected sidebar surface", async () => {
    const { i18n } = await import("@lingui/core");
    const { container } = render(
      <MemoryRouter initialEntries={["/search"]}>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={sessions}
            currentSessionId="chat-1"
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            isLoading={false}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    const searchItem = container.querySelector(
      '[data-ui="sidebar-search-item"]',
    );

    // One themeable geometry channel shared with chat rows — no inline styles.
    expect(searchItem).toHaveClass(
      "sidebar-row-geometry",
      "sidebar-row-selected",
    );
    for (const property of [
      "min-height",
      "border-radius",
      "background-color",
    ]) {
      expect(searchItem?.getAttribute("style") ?? "").not.toContain(property);
    }
    expect(searchItem?.classList.contains("opacity-50")).toBe(false);
  });

  it("keeps nav rows on the rail column in slim mode", async () => {
    mockedCollapsedMode = "slim";

    const { i18n } = await import("@lingui/core");
    const { container } = render(
      <MemoryRouter initialEntries={["/search"]}>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={sessions}
            currentSessionId="chat-1"
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            isLoading={false}
            collapsed={true}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    const searchItem = container.querySelector(
      '[data-ui="sidebar-search-item"]',
    );

    // Rail-column geometry: the same token-derived column in both modes, so
    // the icon does not move when the width animates.
    expect(searchItem).toHaveClass(
      "sidebar-content-col-geometry",
      "py-2",
      "sidebar-row-geometry",
      "sidebar-row-selected",
    );
    expect(searchItem).not.toHaveClass("justify-center");
    expect(searchItem).not.toHaveClass("px-3");
  });

  it("persists the recent chats section collapsed state across remounts", async () => {
    // The Recent section only exists in the ungrouped view.
    const { useChatHistoryFilterStore } = await import(
      "@/hooks/chat/store/chatHistoryFilterStore"
    );
    useChatHistoryFilterStore.setState({ groupBy: "none" });

    const { i18n } = await import("@lingui/core");
    const sidebarProps = {
      sessions,
      currentSessionId: "chat-1",
      onSessionSelect: vi.fn(),
      onSessionArchive: vi.fn(),
      isLoading: false,
    };

    const { unmount } = render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar {...sidebarProps} />
        </I18nProvider>
      </MemoryRouter>,
    );

    const recentToggle = screen.getByRole("button", {
      name: "Collapse Recent",
    });
    expect(screen.getByTestId("history-list")).toBeInTheDocument();

    fireEvent.click(recentToggle);

    expect(recentToggle).toHaveAttribute("aria-expanded", "false");
    // The list leaves the DOM once the collapse transition has played out.
    await waitFor(() =>
      expect(screen.queryByTestId("history-list")).not.toBeInTheDocument(),
    );
    expect(
      localStorage.getItem("erato.sidebar.recentChatsSectionExpanded"),
    ).toBe("false");

    unmount();

    render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar {...sidebarProps} />
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("button", { name: "Expand Recent" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("history-list")).not.toBeInTheDocument();
  });

  it.each([
    {
      assistantsEnabled: false,
      assistantHubEnabled: false,
      expectedHref: null,
    },
    {
      assistantsEnabled: true,
      assistantHubEnabled: false,
      expectedHref: "/assistants",
    },
    {
      assistantsEnabled: false,
      assistantHubEnabled: true,
      expectedHref: "/assistant-hub",
    },
    {
      assistantsEnabled: true,
      assistantHubEnabled: true,
      expectedHref: "/assistant-hub",
    },
  ])(
    "renders one assistants navigation target for assistants=$assistantsEnabled and hub=$assistantHubEnabled",
    async ({ assistantsEnabled, assistantHubEnabled, expectedHref }) => {
      mockedAssistantsEnabled = assistantsEnabled;
      mockedAssistantHubEnabled = assistantHubEnabled;
      const { i18n } = await import("@lingui/core");
      const { container } = render(
        <MemoryRouter>
          <I18nProvider i18n={i18n}>
            <ChatHistorySidebar
              sessions={sessions}
              currentSessionId="chat-1"
              onSessionSelect={vi.fn()}
              onSessionArchive={vi.fn()}
              isLoading={false}
            />
          </I18nProvider>
        </MemoryRouter>,
      );

      const assistantsItems = container.querySelectorAll(
        '[data-ui="sidebar-assistants-item"]',
      );

      expect(assistantsItems).toHaveLength(expectedHref == null ? 0 : 1);
      if (expectedHref != null) {
        expect(assistantsItems[0].closest("a")).toHaveAttribute(
          "href",
          expectedHref,
        );
      }
      expect(
        container.querySelector('[data-ui="sidebar-assistant-hub-item"]'),
      ).not.toBeInTheDocument();
    },
  );

  it("marks the unified assistants item active on assistant hub routes", async () => {
    mockedAssistantsEnabled = true;
    mockedAssistantHubEnabled = true;
    const { i18n } = await import("@lingui/core");
    const { container } = render(
      <MemoryRouter initialEntries={["/assistant-hub"]}>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={sessions}
            currentSessionId="chat-1"
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            isLoading={false}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    const assistantsItem = container.querySelector(
      '[data-ui="sidebar-assistants-item"]',
    );

    expect(assistantsItem).toHaveClass(
      "sidebar-row-geometry",
      "sidebar-row-selected",
    );
    expect(assistantsItem?.closest("a")).toBeNull();
  });

  it("hosts the filter menu in the first group header in grouped mode", async () => {
    const today = new Date();
    const daySessions: ChatSession[] = [
      { ...sessions[0], id: "chat-today", updatedAt: today.toISOString() },
      {
        ...sessions[0],
        id: "chat-old",
        updatedAt: new Date("2020-01-01").toISOString(),
      },
    ];

    const { i18n } = await import("@lingui/core");
    render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={daySessions}
            pinnedSessions={sessions}
            onSessionPin={vi.fn()}
            currentSessionId="chat-today"
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            isLoading={false}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    const triggers = screen.getAllByTestId("chat-history-filter-menu-trigger");
    expect(triggers).toHaveLength(1);

    const todayLabel = new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
    }).format(today);
    const firstToggle = screen.getByRole("button", {
      name: `Collapse ${todayLabel}`,
    });
    // A sibling of the first group's collapse toggle, never nested inside it.
    expect(firstToggle).not.toContainElement(triggers[0]);
    expect(firstToggle.parentElement).toContainElement(triggers[0]);
  });

  it("replaces the Recent section with per-group collapsible sections in grouped mode", async () => {
    const today = new Date();
    const daySessions: ChatSession[] = [
      { ...sessions[0], id: "chat-today", updatedAt: today.toISOString() },
      {
        ...sessions[0],
        id: "chat-old",
        updatedAt: new Date("2020-01-01").toISOString(),
      },
    ];

    const { i18n } = await import("@lingui/core");
    const { container } = render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={daySessions}
            currentSessionId="chat-today"
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            isLoading={false}
            hasMoreSessions={true}
            onLoadMoreSessions={vi.fn()}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByText("Recent")).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-ui="chat-history-group-header"]'),
    ).toBeNull();

    const todayLabel = new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
    }).format(today);
    expect(
      screen.getByRole("button", { name: `Collapse ${todayLabel}` }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Collapse Older" }),
    ).toHaveAttribute("aria-expanded", "true");

    expect(historyListProps).toHaveLength(2);
    expect(historyListProps[0].sessions.map((s) => s.id)).toEqual([
      "chat-today",
    ]);
    expect(historyListProps[0].hasMore).toBe(false);
    expect(historyListProps[1].sessions.map((s) => s.id)).toEqual(["chat-old"]);
    expect(historyListProps[1].hasMore).toBe(true);
  });

  it("collapses groups individually and moves load-more to the last expanded group", async () => {
    const today = new Date();
    const daySessions: ChatSession[] = [
      { ...sessions[0], id: "chat-today", updatedAt: today.toISOString() },
      {
        ...sessions[0],
        id: "chat-old",
        updatedAt: new Date("2020-01-01").toISOString(),
      },
    ];
    const todayLabel = new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
    }).format(today);

    const { i18n } = await import("@lingui/core");
    render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={daySessions}
            currentSessionId="chat-today"
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            isLoading={false}
            hasMoreSessions={true}
            onLoadMoreSessions={vi.fn()}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    historyListProps.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Collapse Older" }));

    // The load-more sentinel moves to today's rows immediately; the collapsed
    // list itself only leaves the DOM after the collapse transition.
    expect(historyListProps).toHaveLength(2);
    expect(historyListProps[0].sessions.map((s) => s.id)).toEqual([
      "chat-today",
    ]);
    expect(historyListProps[0].hasMore).toBe(true);
    expect(historyListProps[1].sessions.map((s) => s.id)).toEqual(["chat-old"]);
    expect(historyListProps[1].hasMore).toBe(false);
    await waitFor(() =>
      expect(screen.getAllByTestId("history-list")).toHaveLength(1),
    );

    fireEvent.click(
      screen.getByRole("button", { name: `Collapse ${todayLabel}` }),
    );

    // All groups collapsed: no list, hence no sentinel anywhere.
    await waitFor(() =>
      expect(screen.queryByTestId("history-list")).not.toBeInTheDocument(),
    );

    historyListProps.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Expand Older" }));

    expect(historyListProps).toHaveLength(1);
    expect(historyListProps[0].sessions.map((s) => s.id)).toEqual(["chat-old"]);
    expect(historyListProps[0].hasMore).toBe(true);
  });

  it("renders the Recent section with a single unlabeled list when grouping is off", async () => {
    const { useChatHistoryFilterStore } = await import(
      "@/hooks/chat/store/chatHistoryFilterStore"
    );
    useChatHistoryFilterStore.setState({ groupBy: "none" });

    const { i18n } = await import("@lingui/core");
    const { container } = render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={sessions}
            currentSessionId="chat-1"
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            isLoading={false}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(
      container.querySelector('[data-ui="chat-history-group"]'),
    ).toBeNull();
    expect(screen.getAllByTestId("history-list")).toHaveLength(1);

    const recentToggle = screen.getByRole("button", {
      name: "Collapse Recent",
    });
    const triggers = screen.getAllByTestId("chat-history-filter-menu-trigger");
    expect(triggers).toHaveLength(1);
    expect(recentToggle).not.toContainElement(triggers[0]);
  });

  it("keeps the filter trigger reachable when grouped mode has no sessions", async () => {
    const { i18n } = await import("@lingui/core");
    const { container } = render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={[]}
            currentSessionId={null}
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            isLoading={false}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    const filterRow = container.querySelector(
      '[data-ui="chat-history-filter-row"]',
    );
    expect(filterRow).toContainElement(
      screen.getByTestId("chat-history-filter-menu-trigger"),
    );
    expect(screen.queryByText("Recent")).not.toBeInTheDocument();
    expect(screen.queryByTestId("history-list")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("chat-history-no-filter-matches"),
    ).not.toBeInTheDocument();
  });

  it("shows the no-matches row when non-default filters leave the list empty", async () => {
    mockedAssistantsEnabled = true;
    const { useChatHistoryFilterStore } = await import(
      "@/hooks/chat/store/chatHistoryFilterStore"
    );
    useChatHistoryFilterStore.setState({ typeFilter: "assistant" });

    const { i18n } = await import("@lingui/core");
    render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={[]}
            currentSessionId={null}
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            isLoading={false}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId("chat-history-no-filter-matches"),
    ).toHaveTextContent("No chats match the current filters");
    expect(
      screen.getByTestId("chat-history-filter-menu-trigger"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("history-list")).not.toBeInTheDocument();
  });

  it("keeps the empty ungrouped list without the no-matches row when only grouping changed", async () => {
    const { useChatHistoryFilterStore } = await import(
      "@/hooks/chat/store/chatHistoryFilterStore"
    );
    useChatHistoryFilterStore.setState({ groupBy: "none" });

    const { i18n } = await import("@lingui/core");
    render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={[]}
            currentSessionId={null}
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            isLoading={false}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    // Grouping alone cannot exclude chats, so an empty list is just empty.
    expect(
      screen.queryByTestId("chat-history-no-filter-matches"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByTestId("history-list")).toHaveLength(1);
    expect(historyListProps[0].sessions).toEqual([]);
  });
});
