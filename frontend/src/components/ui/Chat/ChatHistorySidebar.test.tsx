import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen } from "@testing-library/react";
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
      width: "var(--theme-layout-sidebar-width)",
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

    expect(searchItem).toHaveStyle({
      backgroundColor: "var(--theme-shell-sidebar-selected)",
      minHeight: "var(--theme-spacing-sidebar-row-height)",
      borderRadius: "var(--theme-radius-shell)",
    });
    expect(searchItem?.classList.contains("opacity-50")).toBe(false);
  });

  it("uses the original slim-mode row geometry for nav items", async () => {
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

    expect(searchItem).toHaveClass("min-w-[44px]", "px-3", "py-2");
    expect(searchItem).toHaveStyle({
      backgroundColor: "var(--theme-shell-sidebar-selected)",
      minHeight: "var(--theme-spacing-sidebar-row-height)",
      borderRadius: "var(--theme-radius-shell)",
    });
  });

  it("persists the recent chats section collapsed state across remounts", async () => {
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
    expect(screen.queryByTestId("history-list")).not.toBeInTheDocument();
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

    expect(assistantsItem).toHaveStyle({
      backgroundColor: "var(--theme-shell-sidebar-selected)",
    });
    expect(assistantsItem?.closest("a")).toBeNull();
  });

  it("renders the filter menu only in the Recent section header", async () => {
    const { i18n } = await import("@lingui/core");
    render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={sessions}
            pinnedSessions={sessions}
            onSessionPin={vi.fn()}
            currentSessionId="chat-1"
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            isLoading={false}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    const triggers = screen.getAllByTestId("chat-history-filter-menu-trigger");
    expect(triggers).toHaveLength(1);
    // A sibling of the collapse toggle, never nested inside it.
    expect(
      triggers[0].closest("button[aria-expanded]")?.getAttribute("aria-label"),
    ).not.toBe("Collapse Recent");
  });

  it("groups recent chats by day and gives only the last list the load-more props", async () => {
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

    const headers = Array.from(
      container.querySelectorAll('[data-ui="chat-history-group-header"]'),
    ).map((header) => header.textContent);
    expect(headers).toEqual([
      new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
      }).format(today),
      "Older",
    ]);

    expect(historyListProps).toHaveLength(2);
    expect(historyListProps[0].sessions.map((s) => s.id)).toEqual([
      "chat-today",
    ]);
    expect(historyListProps[0].hasMore).toBe(false);
    expect(historyListProps[1].sessions.map((s) => s.id)).toEqual(["chat-old"]);
    expect(historyListProps[1].hasMore).toBe(true);
  });

  it("renders a single unlabeled list when grouping is off", async () => {
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
      container.querySelector('[data-ui="chat-history-group-header"]'),
    ).toBeNull();
    expect(screen.getAllByTestId("history-list")).toHaveLength(1);
  });

  it("renders an empty recent list without groups when there are no sessions", async () => {
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

    expect(
      container.querySelector('[data-ui="chat-history-group-header"]'),
    ).toBeNull();
    expect(screen.getAllByTestId("history-list")).toHaveLength(1);
    expect(historyListProps[0].sessions).toEqual([]);
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
    expect(screen.queryByTestId("history-list")).not.toBeInTheDocument();
  });
});
