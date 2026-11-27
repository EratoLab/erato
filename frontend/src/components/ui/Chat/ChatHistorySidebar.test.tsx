import { I18nProvider } from "@lingui/react";
import { skipToken } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { ChatHistorySidebar } from "./ChatHistorySidebar";
import { useSidebarPage } from "./sidebarPage";

import type { ChatSession } from "@/types/chat";
import type { I18n, Messages } from "@lingui/core";

let mockedFiltersEnabled = true;
let mockedCollapsedMode = "hidden";
let mockedLogoPath: string | null = null;
let mockedAssistantsEnabled = false;
let mockedAssistantHubEnabled = false;
let mockedScheduledEnabled = false;
let mockedNarrowScreen = false;
const mockUseChatDetail = vi.fn();
let mockedScheduledLists: Record<string, { data?: unknown; error?: unknown }> =
  {};

vi.mock("@/components/providers/ThemeProvider", () => ({
  useTheme: () => ({
    effectiveTheme: "light",
    customThemeName: null,
    // The sidebar reads its logo from here, not from the existence check.
    assetPaths: { assistantAvatar: null, sidebarLogo: mockedLogoPath },
  }),
}));

vi.mock("@/config/themeConfig", () => ({
  defaultThemeConfig: {
    getSidebarLogoPath: () => null,
  },
}));

const mockReleaseLeftEdge = vi.fn();
const mockClaimLeftEdge = vi.fn((_shell: unknown) => mockReleaseLeftEdge);
vi.mock("@/lib/hostLeftEdge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hostLeftEdge")>()),
  claimLeftEdge: (shell: unknown) => mockClaimLeftEdge(shell),
}));
vi.mock("@/hooks/ui", () => ({
  useIsNarrowScreen: () => mockedNarrowScreen,
  useResponsiveCollapsedMode: (mode: string) => mode,
  useThemedIcon: () => null,
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useChatDetail: (...args: unknown[]) => mockUseChatDetail(...args),
  useAssistantHubConfig: () => ({
    data: { enabled: mockedAssistantHubEnabled },
  }),
  useListScheduledItems: ({
    queryParams,
  }: {
    queryParams: { tab: "upcoming" | "past" };
  }) => mockedScheduledLists[queryParams.tab] ?? { data: undefined },
}));

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useAssistantsFeature: () => ({
    enabled: mockedAssistantsEnabled,
    showRecentItems: false,
    showRecentItemsCollapsible: false,
  }),
  useScheduledFeature: () => ({ enabled: mockedScheduledEnabled }),
  useSidebarFeature: () => ({
    collapsedMode: mockedCollapsedMode,
    logoPath: mockedLogoPath,
    logoDarkPath: null,
    chatHistorySources: [],
    chatHistoryFiltersEnabled: mockedFiltersEnabled,
  }),
}));

vi.mock("@/utils/themeUtils", () => ({
  checkFileExists: vi.fn(async () => mockedLogoPath !== null),
}));

const historyListProps = vi.hoisted(
  () =>
    [] as {
      sessions: { id: string }[];
      hasMore?: boolean;
      onSessionSelect?: (sessionId: string) => void;
      onSessionUnarchive?: (sessionId: string) => void;
    }[],
);
vi.mock("./ChatHistoryList", () => ({
  ChatHistoryList: (props: {
    sessions: { id: string }[];
    hasMore?: boolean;
    onSessionSelect?: (sessionId: string) => void;
    onSessionUnarchive?: (sessionId: string) => void;
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

const todaySession = (): ChatSession => ({
  ...sessions[0],
  id: "chat-today",
  updatedAt: new Date().toISOString(),
});
const olderSession = (id: string): ChatSession => ({
  ...sessions[0],
  id,
  updatedAt: new Date("2020-01-01").toISOString(),
});
const pagedSidebar = (
  i18n: I18n,
  pageSessions: ChatSession[],
  isLoadingMoreSessions: boolean,
) => (
  <MemoryRouter>
    <I18nProvider i18n={i18n}>
      <ChatHistorySidebar
        sessions={pageSessions}
        currentSessionId="chat-today"
        onSessionSelect={vi.fn()}
        onSessionArchive={vi.fn()}
        onSessionUnarchive={vi.fn()}
        isLoading={false}
        hasMoreSessions={true}
        isLoadingMoreSessions={isLoadingMoreSessions}
        onLoadMoreSessions={vi.fn()}
      />
    </I18nProvider>
  </MemoryRouter>
);

describe("ChatHistorySidebar", () => {
  it("shows the ungrouped recent list without a filter menu when disabled", async () => {
    mockedFiltersEnabled = false;
    const { useChatHistoryFilterStore } = await import(
      "@/hooks/chat/store/chatHistoryFilterStore"
    );
    useChatHistoryFilterStore.setState({
      groupBy: "date",
      statusFilter: "all",
    });
    const { i18n } = await import("@lingui/core");
    const { container } = render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={sessions}
            currentSessionId="chat-1"
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            onSessionUnarchive={vi.fn()}
            isLoading={false}
          />
        </I18nProvider>
      </MemoryRouter>,
    );
    expect(
      screen.queryByTestId("chat-history-filter-menu-trigger"),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-ui="chat-history-group"]'),
    ).toBeNull();
    expect(screen.getByText("Recent")).toBeInTheDocument();
  });

  beforeEach(async () => {
    mockedFiltersEnabled = true;
    mockedCollapsedMode = "hidden";
    mockedLogoPath = null;
    mockedAssistantsEnabled = false;
    mockedAssistantHubEnabled = false;
    mockedScheduledEnabled = false;
    mockedNarrowScreen = false;
    mockedScheduledLists = {};
    mockUseChatDetail.mockReset();
    mockUseChatDetail.mockReturnValue({ data: undefined });
    localStorage.clear();
    historyListProps.length = 0;
    const { CHAT_HISTORY_FILTER_DEFAULTS, useChatHistoryFilterStore } =
      await import("@/hooks/chat/store/chatHistoryFilterStore");
    useChatHistoryFilterStore.setState({ ...CHAT_HISTORY_FILTER_DEFAULTS });
    // The attention count comes from the real store, so a seeded chat would
    // otherwise leak a badge into every later test.
    const { useGenerationStatusStore } = await import(
      "@/hooks/chat/store/generationStatusStore"
    );
    useGenerationStatusStore.getState().reset();
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
            onSessionUnarchive={vi.fn()}
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
    // One primitive, one height formula — and only while nothing sizes it inline.
    for (const edge of ["sidebar-header", "sidebar-footer"]) {
      const band = container.querySelector(`[data-ui="${edge}"]`);
      expect(band).toHaveClass("sidebar-section-skin", "sidebar-band-geometry");
      expect(band).not.toHaveAttribute("style");
    }
    expect(screen.getByTestId("history-list")).toBeInTheDocument();
  });

  const titleSidebar = async (
    currentSessionId: string | null = "run-1",
    pinnedSessions: ChatSession[] = [],
  ) => {
    const { i18n } = await import("@lingui/core");
    return (
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={sessions}
            pinnedSessions={pinnedSessions}
            currentSessionId={currentSessionId}
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            onSessionUnarchive={vi.fn()}
            isLoading={false}
          />
        </I18nProvider>
      </MemoryRouter>
    );
  };

  it("sets a delegated run's browser title without a listing row", async () => {
    mockUseChatDetail.mockReturnValue({
      data: {
        id: "run-1",
        provenance_kind: "delegation",
        title_resolved: "Research the numbers",
      },
    });
    render(await titleSidebar());

    const { i18n } = await import("@lingui/core");
    expect(mockUseChatDetail).toHaveBeenCalledWith({
      pathParams: { chatId: "run-1" },
    });
    expect(document.title).toBe(
      `Research the numbers - ${i18n._("branding.page_title_suffix")}`,
    );
  });

  it("updates the browser title when the unlisted chat's details arrive", async () => {
    const { rerender } = render(await titleSidebar());
    mockUseChatDetail.mockReturnValue({
      data: { title_resolved: "Loaded run" },
    });
    rerender(await titleSidebar());

    const { i18n } = await import("@lingui/core");
    expect(document.title).toBe(
      `Loaded run - ${i18n._("branding.page_title_suffix")}`,
    );
  });

  it.each(["recent", "pinned"])(
    "uses the %s listing title without fetching details",
    async (listing) => {
      const { i18n } = await import("@lingui/core");
      render(
        await titleSidebar(
          listing === "recent" ? "chat-1" : "run-1",
          listing === "pinned" ? [{ ...sessions[0], id: "run-1" }] : [],
        ),
      );

      expect(mockUseChatDetail).toHaveBeenCalledWith(skipToken);
      expect(document.title).toBe(
        `First chat - ${i18n._("branding.page_title_suffix")}`,
      );
    },
  );

  it("preserves another page's title when there is no current chat", async () => {
    document.title = "Another page";
    render(await titleSidebar(null));

    expect(mockUseChatDetail).toHaveBeenCalledWith(skipToken);
    expect(document.title).toBe("Another page");
  });

  it("flips the expanded toggle's glyph rather than the button", async () => {
    const { i18n } = await import("@lingui/core");
    render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={sessions}
            currentSessionId="chat-1"
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            onSessionUnarchive={vi.fn()}
            isLoading={false}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    const toggle = screen.getByRole("button", { name: "collapse sidebar" });

    const glyph = toggle.querySelector('[aria-hidden="true"]');
    expect(glyph).toHaveClass("rotate-180");
    expect(glyph?.querySelector("svg")).not.toBeNull();
    expect(toggle).not.toHaveClass("rotate-180");

    expect(toggle).toHaveClass("sidebar-icon-col-geometry");
    expect(toggle).toHaveAttribute("data-surface", "flush");
    expect(toggle).toHaveAttribute("data-variant", "sidebar-icon");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("tabindex", "0");
  });

  it("paints the hidden-mode toggle from the floating recipe, not inline", async () => {
    const { i18n } = await import("@lingui/core");
    const { container } = render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={sessions}
            currentSessionId="chat-1"
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            onSessionUnarchive={vi.fn()}
            isLoading={false}
            collapsed={true}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    const toggle = screen.getByRole("button", { name: "expand sidebar" });

    // Outside the element a theme blurs, so the surface must be opaque.
    expect(container.querySelector('[data-ui="sidebar"]')).not.toContainElement(
      toggle,
    );
    expect(toggle).toHaveClass(
      "floating-control-skin",
      "border",
      "absolute",
      "left-2",
      "top-2",
      "z-[43]",
    );
    expect(toggle).not.toHaveAttribute("style");
    // The caller positions it, so the primitive must not add `relative`.
    expect(toggle).not.toHaveClass("relative");
    expect(toggle).toHaveAttribute("data-surface", "floating");
    expect(toggle).toHaveAttribute("data-variant", "sidebar-icon");
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
            onSessionUnarchive={vi.fn()}
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
            onSessionUnarchive={vi.fn()}
            isLoading={false}
            collapsed={true}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    const searchItem = container.querySelector(
      '[data-ui="sidebar-search-item"]',
    );

    // The same token-derived column in both modes, so the icon does not move.
    expect(searchItem).toHaveClass(
      "sidebar-content-col-geometry",
      "py-2",
      "sidebar-row-geometry",
      "sidebar-row-selected",
    );
    expect(searchItem).not.toHaveClass("justify-center");
    expect(searchItem).not.toHaveClass("px-3");

    // The margin has to reach the button itself; a wrapper would centre nothing.
    const toggle = screen.getByRole("button", { name: "expand sidebar" });
    expect(toggle).toHaveClass("sidebar-icon-col-geometry");
    expect(toggle).not.toHaveAttribute("style");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("nests the attention badge in the slim toggle, behind its glyph", async () => {
    mockedCollapsedMode = "slim";
    const { useGenerationStatusStore } = await import(
      "@/hooks/chat/store/generationStatusStore"
    );
    useGenerationStatusStore.setState({
      statusByChatId: {
        "chat-2": {
          kind: "running",
          startedAt: new Date().toISOString(),
          localSeenAt: Date.now(),
        },
      },
    });

    const { i18n } = await import("@lingui/core");
    render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={sessions}
            currentSessionId="chat-1"
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            onSessionUnarchive={vi.fn()}
            isLoading={false}
            collapsed={true}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    // The badge is aria-hidden, so the name carries the count — bare phrase
    // first, because e2e looks the toggle up by substring.
    const toggle = screen.getByRole("button", {
      name: "expand sidebar, 1 chat needs attention",
    });
    const badge = screen.getByTestId("sidebar-generation-badge");
    expect(badge).toHaveTextContent("1");
    expect(toggle).toContainElement(badge);

    // The probe measures the first aria-hidden node, so the badge comes last.
    const firstHidden = toggle.querySelector('[aria-hidden="true"]');
    expect(firstHidden).not.toBe(badge);
    expect(firstHidden?.querySelector("svg")).not.toBeNull();

    expect(toggle).toHaveClass("relative");
  });

  // The logo face replaces the toggle's glyph span entirely, so the badge is
  // the only aria-hidden node the primitive itself contributes. The face has
  // to supply the anchor, or the rail centerline gets measured against a 16px
  // pill in the corner instead of a centred 20px glyph.
  it("keeps the geometry anchor on the glyph when a logo face carries the badge", async () => {
    mockedCollapsedMode = "slim";
    mockedLogoPath = "/custom-theme/sidebar-logo.svg";

    const { useGenerationStatusStore } = await import(
      "@/hooks/chat/store/generationStatusStore"
    );
    useGenerationStatusStore.setState({
      statusByChatId: {
        "chat-2": {
          kind: "running",
          startedAt: new Date().toISOString(),
          localSeenAt: Date.now(),
        },
      },
    });

    const { i18n } = await import("@lingui/core");
    render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={sessions}
            currentSessionId="chat-1"
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            onSessionUnarchive={vi.fn()}
            isLoading={false}
            collapsed={true}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    // The logo resolves through an async existence check, and the face and the
    // plain toggle are different components — React swaps the button node when
    // it lands, so anchor on the image rather than on a button queried first.
    const logo = await screen.findByAltText("Logo");
    const toggle = logo.closest("button");
    const badge = screen.getByTestId("sidebar-generation-badge");

    // The e2e spec locates the logo as a descendant of the header's first
    // button, so the face has to stay inside the control.
    expect(toggle).not.toBeNull();
    expect(toggle).toContainElement(badge);
    expect(toggle).toHaveAccessibleName(
      "expand sidebar, 1 chat needs attention",
    );

    const firstHidden = toggle?.querySelector('[aria-hidden="true"]');
    expect(firstHidden).not.toBe(badge);
    expect(firstHidden?.tagName.toLowerCase()).toBe("svg");
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
      onSessionUnarchive: vi.fn(),
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
              onSessionUnarchive={vi.fn()}
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
            onSessionUnarchive={vi.fn()}
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

  const renderSidebarAt = async (path: string, collapsed = false) => {
    const { i18n } = await import("@lingui/core");
    return render(
      <MemoryRouter initialEntries={[path]}>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={sessions}
            currentSessionId="chat-1"
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            onSessionUnarchive={vi.fn()}
            isLoading={false}
            collapsed={collapsed}
          />
        </I18nProvider>
      </MemoryRouter>,
    );
  };

  it("hides the Scheduled entry while its flag is off", async () => {
    mockedScheduledEnabled = false;
    const { container } = await renderSidebarAt("/chat/new");

    expect(
      container.querySelector('[data-ui="sidebar-scheduled-item"]'),
    ).toBeNull();
    expect(screen.queryByText("Scheduled")).not.toBeInTheDocument();
  });

  it("links the Scheduled entry after Assistants when its flag is on", async () => {
    mockedScheduledEnabled = true;
    mockedAssistantsEnabled = true;
    const { container } = await renderSidebarAt("/chat/new");

    const scheduledItem = container.querySelector(
      '[data-ui="sidebar-scheduled-item"]',
    );
    const assistantsItem = container.querySelector(
      '[data-ui="sidebar-assistants-item"]',
    );

    expect(scheduledItem?.closest("a")).toHaveAttribute("href", "/scheduled");
    expect(scheduledItem).toHaveTextContent("Scheduled");
    expect(
      assistantsItem!.compareDocumentPosition(scheduledItem!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  describe("the Scheduled entry's warning dot", () => {
    const listOf = (dueAt: string, status = "failed") => ({
      data: {
        items: [
          {
            id: `item-${status}`,
            type: "reminder",
            name: "Follow up on the offer",
            message: "",
            trigger: { kind: "once", date: "2026-11-06", time: "09:00" },
            time_zone: "Europe/Berlin",
            status,
            occurrence_count: 1,
            channel: "teams_personal",
            channel_status: "connected",
            last_delivery: {
              due: { at: dueAt, local: dueAt },
              outcome: status,
            },
            created_at: dueAt,
            updated_at: dueAt,
          },
        ],
        upcoming_count: 0,
        past_count: 1,
        time_zone: "Europe/Berlin",
        time_zone_source: "user",
        channels: [],
        max_upcoming: 10,
      },
    });
    const daysAgo = (days: number) =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const dot = (container: HTMLElement) =>
      container.querySelector('[data-testid="sidebar-navigation-warning"]');

    beforeEach(() => {
      mockedScheduledEnabled = true;
    });

    it("shows while the page's failure alert would, and names why", async () => {
      mockedScheduledLists = { past: listOf(daysAgo(2)) };
      const { container } = await renderSidebarAt("/chat/new");

      expect(dot(container)).not.toBeNull();
      expect(
        screen.getByRole("link", {
          name: "Scheduled, something could not be carried out",
        }),
      ).toHaveAttribute("href", "/scheduled");
    });

    it("stays off for a failure older than the alert's window", async () => {
      mockedScheduledLists = { past: listOf(daysAgo(8)) };
      const { container } = await renderSidebarAt("/chat/new");

      expect(dot(container)).toBeNull();
      expect(
        screen.getByRole("link", { name: "Scheduled" }),
      ).toBeInTheDocument();
    });

    it("stays off when nothing failed or the page could not load", async () => {
      mockedScheduledLists = { past: listOf(daysAgo(1), "done") };
      const { container, unmount } = await renderSidebarAt("/chat/new");
      expect(dot(container)).toBeNull();
      unmount();

      mockedScheduledLists = {
        upcoming: { error: new Error("offline") },
        past: listOf(daysAgo(1)),
      };
      const reloaded = await renderSidebarAt("/chat/new");
      expect(dot(reloaded.container)).toBeNull();
    });

    it("stays on the icon in slim mode, with the reason in the tooltip", async () => {
      mockedCollapsedMode = "slim";
      mockedScheduledLists = { upcoming: listOf(daysAgo(0)) };
      const { container } = await renderSidebarAt("/chat/new", true);

      expect(dot(container)).not.toBeNull();
      expect(
        container
          .querySelector('[data-ui="sidebar-scheduled-item"]')
          ?.closest("a"),
      ).toHaveAttribute(
        "title",
        "Scheduled, something could not be carried out",
      );
    });
  });

  it("marks the Scheduled entry active on its page", async () => {
    mockedScheduledEnabled = true;
    const { container } = await renderSidebarAt("/scheduled");

    const scheduledItem = container.querySelector(
      '[data-ui="sidebar-scheduled-item"]',
    );

    expect(scheduledItem).toHaveClass("sidebar-row-selected");
    expect(scheduledItem?.closest("a")).toBeNull();
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
            onSessionUnarchive={vi.fn()}
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

  it("forwards the unarchive handler to the pinned, ungrouped and grouped lists", async () => {
    const { useChatHistoryFilterStore } = await import(
      "@/hooks/chat/store/chatHistoryFilterStore"
    );
    const { i18n } = await import("@lingui/core");
    const onSessionUnarchive = vi.fn();
    const sidebarProps = {
      sessions,
      pinnedSessions: sessions,
      currentSessionId: "chat-1",
      onSessionSelect: vi.fn(),
      onSessionArchive: vi.fn(),
      onSessionUnarchive,
      onSessionPin: vi.fn(),
      isLoading: false,
    };

    useChatHistoryFilterStore.setState({ groupBy: "none" });
    const { unmount } = render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar {...sidebarProps} />
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(historyListProps).toHaveLength(2);
    unmount();

    useChatHistoryFilterStore.setState({ groupBy: "date" });
    render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar {...sidebarProps} />
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(historyListProps).toHaveLength(4);
    for (const captured of historyListProps) {
      expect(captured.onSessionUnarchive).toBe(onSessionUnarchive);
    }
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
            onSessionUnarchive={vi.fn()}
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
            onSessionUnarchive={vi.fn()}
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

  it("keeps loading while each page adds rows to an open group", async () => {
    const { i18n } = await import("@lingui/core");
    const firstPage = [todaySession(), olderSession("chat-old-1")];
    const { rerender } = render(pagedSidebar(i18n, firstPage, false));

    rerender(pagedSidebar(i18n, firstPage, true));
    rerender(
      pagedSidebar(i18n, [...firstPage, olderSession("chat-old-2")], false),
    );

    expect(historyListProps.at(-1)?.sessions.map((s) => s.id)).toEqual([
      "chat-old-1",
      "chat-old-2",
    ]);
    expect(historyListProps.at(-1)?.hasMore).toBe(true);
  });

  it("stops loading older chats while each page lands only in a collapsed group", async () => {
    const { i18n } = await import("@lingui/core");
    const firstPage = [todaySession(), olderSession("chat-old-1")];
    const { rerender } = render(pagedSidebar(i18n, firstPage, false));
    fireEvent.click(screen.getByRole("button", { name: "Collapse Older" }));
    await waitFor(() =>
      expect(screen.getAllByTestId("history-list")).toHaveLength(1),
    );

    rerender(pagedSidebar(i18n, firstPage, true));
    rerender(
      pagedSidebar(i18n, [...firstPage, olderSession("chat-old-2")], false),
    );

    expect(historyListProps.at(-1)?.sessions.map((s) => s.id)).toEqual([
      "chat-today",
    ]);
    expect(historyListProps.at(-1)?.hasMore).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Expand Older" }));

    expect(historyListProps.at(-1)?.sessions.map((s) => s.id)).toEqual([
      "chat-old-1",
      "chat-old-2",
    ]);
    expect(historyListProps.at(-1)?.hasMore).toBe(true);
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
            onSessionUnarchive={vi.fn()}
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
            onSessionUnarchive={vi.fn()}
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
            onSessionUnarchive={vi.fn()}
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
            onSessionUnarchive={vi.fn()}
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

  describe("after a pick in the drawer", () => {
    const renderOpenSidebar = async (collapsed = false) => {
      mockedAssistantsEnabled = true;
      mockedScheduledEnabled = true;
      const onToggleCollapse = vi.fn();
      const onSessionSelect = vi.fn();
      const onNewChat = vi.fn();
      const { i18n } = await import("@lingui/core");
      render(
        <MemoryRouter initialEntries={["/chat/chat-1"]}>
          <I18nProvider i18n={i18n}>
            <ChatHistorySidebar
              sessions={sessions}
              currentSessionId="chat-1"
              collapsed={collapsed}
              onToggleCollapse={onToggleCollapse}
              onNewChat={onNewChat}
              onSessionSelect={onSessionSelect}
              onSessionArchive={vi.fn()}
              onSessionUnarchive={vi.fn()}
              isLoading={false}
            />
          </I18nProvider>
        </MemoryRouter>,
      );
      const pickChat = () =>
        historyListProps.at(-1)!.onSessionSelect!("chat-1");
      return { onToggleCollapse, onSessionSelect, onNewChat, pickChat };
    };
    const navigationRows = ["New Chat", "Search", "Assistants", "Scheduled"];
    // On a narrow screen New Chat is the button at the drawer's foot.
    const narrowControl = (label: string) =>
      screen.queryByRole("link", { name: label }) ??
      screen.getByRole("button", { name: label });

    it("closes on a narrow screen once the picked chat is opened", async () => {
      mockedNarrowScreen = true;
      const { onToggleCollapse, onSessionSelect, pickChat } =
        await renderOpenSidebar();

      pickChat();

      expect(onSessionSelect).toHaveBeenCalledWith("chat-1");
      expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    });

    it.each(navigationRows)(
      "closes on a narrow screen after %s",
      async (label) => {
        mockedNarrowScreen = true;
        const { onToggleCollapse } = await renderOpenSidebar();

        fireEvent.click(narrowControl(label));

        expect(onToggleCollapse).toHaveBeenCalledTimes(1);
      },
    );

    it("still starts the new chat on a narrow screen", async () => {
      mockedNarrowScreen = true;
      const { onNewChat } = await renderOpenSidebar();

      fireEvent.click(screen.getByRole("button", { name: "New Chat" }));

      expect(onNewChat).toHaveBeenCalledTimes(1);
    });

    it("puts New Chat at the drawer's foot on a narrow screen and at the top beside the page", async () => {
      mockedNarrowScreen = true;
      await renderOpenSidebar();
      const footer = document.querySelector('[data-ui="sidebar-footer"]')!;
      expect(
        within(footer as HTMLElement).getByRole("button", { name: "New Chat" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "New Chat" })).toBeNull();

      cleanup();
      mockedNarrowScreen = false;
      await renderOpenSidebar();
      expect(
        screen.getByRole("link", { name: "New Chat" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "New Chat" })).toBeNull();
    });

    it("stays open on a wide screen", async () => {
      const { onToggleCollapse, onSessionSelect, pickChat } =
        await renderOpenSidebar();

      pickChat();
      for (const label of navigationRows) {
        fireEvent.click(screen.getByRole("link", { name: label }));
      }

      expect(onSessionSelect).toHaveBeenCalledWith("chat-1");
      expect(onToggleCollapse).not.toHaveBeenCalled();
    });

    it("does not reopen a closed drawer", async () => {
      mockedNarrowScreen = true;
      const { onToggleCollapse, pickChat } = await renderOpenSidebar(true);

      pickChat();

      expect(onToggleCollapse).not.toHaveBeenCalled();
    });
  });

  describe("beside the open drawer", () => {
    const pageAction = vi.fn();
    const ToggleHarness = ({ initiallyOpen }: { initiallyOpen: boolean }) => {
      const [collapsed, setCollapsed] = useState(!initiallyOpen);
      return (
        <>
          <ChatHistorySidebar
            sessions={sessions}
            currentSessionId="chat-1"
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((value) => !value)}
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            onSessionUnarchive={vi.fn()}
            isLoading={false}
          />
          <button type="button" onClick={pageAction}>
            Page action
          </button>
        </>
      );
    };
    const renderDrawer = async (initiallyOpen = true) => {
      const { i18n } = await import("@lingui/core");
      render(
        <MemoryRouter initialEntries={["/chat/chat-1"]}>
          <I18nProvider i18n={i18n}>
            <ToggleHarness initiallyOpen={initiallyOpen} />
          </I18nProvider>
        </MemoryRouter>,
      );
    };
    const sidebarMode = () =>
      document
        .querySelector('[data-ui="sidebar"]')
        ?.getAttribute("data-sidebar-mode");

    beforeEach(() => {
      pageAction.mockReset();
    });

    it("closes on a tap beside it on a narrow screen", async () => {
      mockedNarrowScreen = true;
      await renderDrawer();

      fireEvent.click(screen.getByTestId("sidebar-scrim"));

      expect(sidebarMode()).toBe("hidden");
    });

    it("lies over the whole page while open, so the tap stays off its controls", async () => {
      mockedNarrowScreen = true;
      await renderDrawer();

      const scrim = screen.getByTestId("sidebar-scrim");
      const sidebar = document.querySelector('[data-ui="sidebar"]')!;
      // The pushed page stands at 41, over the sidebar; this over both.
      expect(scrim).toHaveClass("fixed", "inset-0", "z-[42]");
      expect(scrim).not.toHaveClass("pointer-events-none");
      expect(sidebar).toHaveClass("z-40");
    });

    it("lets taps through once the drawer is closed", async () => {
      mockedNarrowScreen = true;
      await renderDrawer(false);

      expect(screen.getByTestId("sidebar-scrim")).toHaveClass(
        "pointer-events-none",
      );
    });

    it("closes on Escape and hands focus to the control that reopens it", async () => {
      mockedNarrowScreen = true;
      await renderDrawer();
      screen.getByRole("link", { name: "Search" }).focus();

      fireEvent.keyDown(document.activeElement!, { key: "Escape" });

      expect(sidebarMode()).toBe("hidden");
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "expand sidebar" }),
        ).toHaveFocus(),
      );
    });

    it("hands focus that was in the drawer to the reopen control on a tap beside it", async () => {
      mockedNarrowScreen = true;
      await renderDrawer();
      screen.getByRole("link", { name: "Search" }).focus();
      const scrim = screen.getByTestId("sidebar-scrim");

      // A browser blurs on a press that is not prevented; jsdom does not.
      expect(fireEvent.mouseDown(scrim)).toBe(false);
      fireEvent.click(scrim);

      expect(sidebarMode()).toBe("hidden");
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "expand sidebar" }),
        ).toHaveFocus(),
      );
    });

    it("leaves focus alone when it was not in the drawer", async () => {
      mockedNarrowScreen = true;
      await renderDrawer();
      const pageButton = screen.getByRole("button", { name: "Page action" });
      pageButton.focus();

      fireEvent.click(screen.getByTestId("sidebar-scrim"));

      expect(sidebarMode()).toBe("hidden");
      expect(pageButton).toHaveFocus();
    });

    it("leaves an Escape meant for a menu over the drawer to that menu", async () => {
      mockedNarrowScreen = true;
      await renderDrawer();
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.tabIndex = -1;
      document.body.append(menu);
      menu.focus();

      fireEvent.keyDown(menu, { key: "Escape" });

      expect(sidebarMode()).toBe("expanded");
      menu.remove();
    });

    it("changes nothing on a wide screen", async () => {
      await renderDrawer();

      expect(screen.queryByTestId("sidebar-scrim")).not.toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: "Escape" });
      fireEvent.click(screen.getByRole("button", { name: "Page action" }));

      expect(sidebarMode()).toBe("expanded");
      expect(pageAction).toHaveBeenCalledTimes(1);
    });
  });

  describe("dragging the drawer", () => {
    const DRAWER_WIDTH = 280;
    const ToggleHarness = ({ initiallyOpen }: { initiallyOpen: boolean }) => {
      const [collapsed, setCollapsed] = useState(!initiallyOpen);
      const sidebarPage = useSidebarPage(collapsed, "hidden");
      return (
        <>
          <ChatHistorySidebar
            pageRef={sidebarPage.ref}
            sessions={sessions}
            currentSessionId="chat-1"
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((value) => !value)}
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            onSessionUnarchive={vi.fn()}
            isLoading={false}
          />
          <div {...sidebarPage} data-testid="page" />
        </>
      );
    };
    const renderDrawer = async (initiallyOpen: boolean) => {
      const { i18n } = await import("@lingui/core");
      render(
        <MemoryRouter initialEntries={["/chat/chat-1"]}>
          <I18nProvider i18n={i18n}>
            <ToggleHarness initiallyOpen={initiallyOpen} />
          </I18nProvider>
        </MemoryRouter>,
      );
    };
    const drawer = () =>
      document.querySelector<HTMLElement>('[data-ui="sidebar"]')!;
    const sidebarMode = () => drawer().getAttribute("data-sidebar-mode");
    const page = () => screen.getByTestId("page");

    // A finger: one touch per event, at a given time in ms.
    const touch = (
      target: Element,
      type: "touchstart" | "touchmove" | "touchend",
      x: number,
      y: number,
      time: number,
    ) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const point = { clientX: x, clientY: y };
      const touchList = (points: (typeof point)[]) =>
        Object.assign([...points], {
          item: (index: number) => points[index] ?? null,
        });
      Object.defineProperties(event, {
        touches: { value: touchList(type === "touchend" ? [] : [point]) },
        changedTouches: { value: touchList([point]) },
        timeStamp: { value: time },
      });
      act(() => {
        target.dispatchEvent(event);
      });
      return event;
    };
    /** Moves in 10 steps over `ms`, then lifts. Returns the last move. */
    const drag = (target: Element, fromX: number, toX: number, ms: number) => {
      const y = 400;
      touch(target, "touchstart", fromX, y, 0);
      let last: Event | undefined;
      for (let step = 1; step <= 10; step += 1) {
        last = touch(
          target,
          "touchmove",
          fromX + ((toX - fromX) * step) / 10,
          y,
          (ms * step) / 10,
        );
      }
      // Holding still before lifting: a slow release, not a flick.
      touch(target, "touchend", toX, y, ms + 200);
      runFrames(2);
      return last!;
    };
    // The page switches two frames after the release; frames run on demand.
    let frameQueue = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const runFrames = (count: number) => {
      for (let frame = 0; frame < count; frame += 1) {
        const due = [...frameQueue.values()];
        frameQueue = new Map();
        act(() => {
          due.forEach((callback) => callback(0));
        });
      }
    };

    const shellRequest = vi.fn((_name: string, _args?: unknown) =>
      Promise.resolve(null),
    );
    const haptics = () =>
      shellRequest.mock.calls.filter(([name]) => name === "haptics.play");

    beforeEach(() => {
      mockedNarrowScreen = true;
      shellRequest.mockClear();
      window.ERATO_SHELL = {
        contract: 1,
        capabilities: { leftEdgeSwipe: 1, haptics: 1 },
        request: shellRequest,
        on: () => () => {},
      };
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        DOMRect.fromRect({ width: DRAWER_WIDTH, height: 800 }),
      );
      frameQueue = new Map();
      vi.spyOn(window, "requestAnimationFrame").mockImplementation(
        (callback) => {
          frameId += 1;
          frameQueue.set(frameId, callback);
          return frameId;
        },
      );
      vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
        frameQueue.delete(id);
      });
    });
    afterEach(() => {
      delete window.ERATO_SHELL;
      vi.restoreAllMocks();
    });

    it("follows the finger in from the edge and stays open past half", async () => {
      await renderDrawer(false);
      const edge = screen.getByTestId("sidebar-edge");

      touch(edge, "touchstart", 5, 400, 0);
      const move = touch(edge, "touchmove", 145, 400, 400);

      expect(move.defaultPrevented).toBe(true);
      expect(drawer().style.transform).toBe("translateX(-140px)");
      expect(screen.getByTestId("sidebar-scrim").style.opacity).toBe("0.5");

      touch(edge, "touchmove", 185, 400, 600);
      touch(edge, "touchend", 185, 400, 800);
      runFrames(2);

      expect(sidebarMode()).toBe("expanded");
      await waitFor(() => expect(drawer().style.transform).toBe(""));
    });

    it("pushes the page aside with the finger and keeps it there once open", async () => {
      await renderDrawer(false);
      const edge = screen.getByTestId("sidebar-edge");
      const scrim = screen.getByTestId("sidebar-scrim");
      expect(page()).not.toHaveAttribute("data-sidebar-pushed");
      // Set before any drag, so a drag starting changes no stacking.
      expect(page()).toHaveAttribute("data-sidebar-pushable");

      touch(edge, "touchstart", 5, 400, 0);
      touch(edge, "touchmove", 145, 400, 400);

      expect(page().style.transform).toBe("translateX(140px)");
      expect(scrim.style.transform).toBe("translateX(140px)");
      expect(page()).toHaveAttribute("data-sidebar-moving");
      expect(scrim).toHaveAttribute("data-sidebar-moving");

      touch(edge, "touchmove", 185, 400, 600);
      touch(edge, "touchend", 185, 400, 800);
      expect(page().style.transform).toBe(`translateX(${DRAWER_WIDTH}px)`);
      runFrames(2);

      expect(page()).toHaveAttribute("data-sidebar-pushed");
      expect(scrim).toHaveAttribute("data-sidebar-pushed");
      await waitFor(() => {
        expect(page().style.transform).toBe("");
        expect(page().style.transition).toBe("");
        expect(page()).not.toHaveAttribute("data-sidebar-moving");
        expect(scrim.style.transform).toBe("");
      });
    });

    it("brings the page back when the dimmed page is dragged left", async () => {
      await renderDrawer(true);
      expect(page()).toHaveAttribute("data-sidebar-pushed");

      const scrim = screen.getByTestId("sidebar-scrim");
      touch(scrim, "touchstart", 350, 400, 0);
      touch(scrim, "touchmove", 210, 400, 400);
      expect(page().style.transform).toBe("translateX(140px)");

      touch(scrim, "touchmove", 60, 400, 600);
      touch(scrim, "touchend", 60, 400, 800);
      runFrames(2);

      expect(sidebarMode()).toBe("hidden");
      expect(page()).not.toHaveAttribute("data-sidebar-pushed");
      await waitFor(() => {
        expect(page().style.transform).toBe("");
        expect(page()).not.toHaveAttribute("data-sidebar-moving");
      });
    });

    it("brings the page back on a tap on it", async () => {
      await renderDrawer(true);
      const scrim = screen.getByTestId("sidebar-scrim");

      fireEvent.click(scrim);

      expect(sidebarMode()).toBe("hidden");
      expect(page()).not.toHaveAttribute("data-sidebar-pushed");
      expect(scrim).not.toHaveAttribute("data-sidebar-pushed");
      expect(page()).toHaveAttribute("data-sidebar-pushable");
    });

    it("brings the page back from where it is when turned back during the slide", async () => {
      await renderDrawer(false);
      const edge = screen.getByTestId("sidebar-edge");

      touch(edge, "touchstart", 5, 400, 0);
      touch(edge, "touchmove", 185, 400, 600);
      touch(edge, "touchend", 185, 400, 800);
      runFrames(2);
      expect(sidebarMode()).toBe("expanded");

      fireEvent.click(screen.getByTestId("sidebar-scrim"));

      expect(sidebarMode()).toBe("hidden");
      expect(page().style.transform).toBe("");
      expect(page().style.transition).toBe("");
      expect(page()).not.toHaveAttribute("data-sidebar-moving");
    });

    it("keeps the page in place on a wide screen", async () => {
      mockedNarrowScreen = false;
      await renderDrawer(true);

      expect(sidebarMode()).toBe("expanded");
      expect(page()).not.toHaveAttribute("data-sidebar-pushed");
      expect(page()).not.toHaveAttribute("data-sidebar-pushable");
    });

    it("starts the slide before the page switches", async () => {
      await renderDrawer(false);
      const edge = screen.getByTestId("sidebar-edge");
      const scrim = screen.getByTestId("sidebar-scrim");

      touch(edge, "touchstart", 5, 400, 0);
      touch(edge, "touchmove", 185, 400, 600);
      touch(edge, "touchend", 185, 400, 800);

      expect(drawer().style.transform).toBe("translateX(0px)");
      expect(scrim.style.opacity).toBe("1");
      expect(scrim.style.pointerEvents).toBe("auto");
      expect(sidebarMode()).toBe("hidden");

      runFrames(1);
      expect(sidebarMode()).toBe("hidden");
      runFrames(1);
      expect(sidebarMode()).toBe("expanded");
      // The slide finishes on its inline position, then hands over.
      expect(drawer().style.transform).toBe("translateX(0px)");
      await waitFor(() => {
        expect(drawer().style.transform).toBe("");
        expect(scrim.style.pointerEvents).toBe("");
      });
    });

    it("switches at once when a finger comes down during the slide", async () => {
      await renderDrawer(false);

      const edge = screen.getByTestId("sidebar-edge");
      touch(edge, "touchstart", 5, 400, 0);
      touch(edge, "touchmove", 185, 400, 600);
      touch(edge, "touchend", 185, 400, 800);
      touch(screen.getByTestId("sidebar-scrim"), "touchstart", 350, 400, 820);

      expect(sidebarMode()).toBe("expanded");
    });

    it("does not undo a switch the page made during the slide", async () => {
      await renderDrawer(true);
      const target = drawer();

      touch(target, "touchstart", 250, 400, 0);
      touch(target, "touchmove", 60, 400, 600);
      touch(target, "touchend", 60, 400, 800);
      fireEvent.click(screen.getByTestId("sidebar-scrim"));
      expect(sidebarMode()).toBe("hidden");

      runFrames(2);
      expect(sidebarMode()).toBe("hidden");
    });

    it("hands the drawer back to the page when it is turned back during the slide", async () => {
      await renderDrawer(true);
      const scrim = screen.getByTestId("sidebar-scrim");

      drag(drawer(), 250, 60, 600);
      expect(sidebarMode()).toBe("hidden");
      expect(drawer().style.opacity).toBe("0");

      fireEvent.click(screen.getByRole("button", { name: "expand sidebar" }));

      expect(sidebarMode()).toBe("expanded");
      expect(drawer().style.transform).toBe("");
      expect(drawer().style.opacity).toBe("");
      expect(drawer().style.pointerEvents).toBe("");
      expect(scrim.style.pointerEvents).toBe("");
    });

    it("leaves nothing behind once a close has slid out", async () => {
      await renderDrawer(true);
      const scrim = screen.getByTestId("sidebar-scrim");

      drag(drawer(), 250, 60, 600);

      await waitFor(() => {
        expect(drawer().style.transform).toBe("");
        expect(drawer().style.opacity).toBe("");
        expect(drawer().style.pointerEvents).toBe("");
        expect(scrim.style.opacity).toBe("");
        expect(scrim.style.pointerEvents).toBe("");
        expect(scrim.style.transform).toBe("");
        expect(page().style.transform).toBe("");
        expect(page().style.transition).toBe("");
        expect(page()).not.toHaveAttribute("data-sidebar-moving");
      });
      // A later touch elsewhere does not switch the page again.
      fireEvent.click(screen.getByRole("button", { name: "expand sidebar" }));
      touch(document.body, "touchstart", 350, 400, 2000);
      expect(sidebarMode()).toBe("expanded");
    });

    it("drops the pending switch when the drawer goes away", async () => {
      await renderDrawer(false);
      const edge = screen.getByTestId("sidebar-edge");

      touch(edge, "touchstart", 5, 400, 0);
      touch(edge, "touchmove", 185, 400, 600);
      touch(edge, "touchend", 185, 400, 800);
      cleanup();

      expect(frameQueue.size).toBe(0);
    });

    it("ticks once when a drag opens or closes it, and not when it springs back", async () => {
      await renderDrawer(false);
      const edge = screen.getByTestId("sidebar-edge");

      drag(edge, 5, 115, 600);
      expect(haptics()).toHaveLength(0);

      drag(edge, 5, 185, 600);
      expect(sidebarMode()).toBe("expanded");
      expect(haptics()).toEqual([["haptics.play", { kind: "light" }]]);

      drag(drawer(), 250, 60, 600);
      expect(sidebarMode()).toBe("hidden");
      expect(haptics()).toHaveLength(2);
    });

    it("springs back from a slow pull short of half", async () => {
      await renderDrawer(false);

      drag(screen.getByTestId("sidebar-edge"), 5, 115, 600);

      expect(sidebarMode()).toBe("hidden");
      expect(drawer().style.transform).toBe("");
      expect(drawer().style.opacity).toBe("");
    });

    it("springs back from a quick pull that stops before the finger lifts", async () => {
      await renderDrawer(false);
      const edge = screen.getByTestId("sidebar-edge");

      touch(edge, "touchstart", 5, 400, 0);
      touch(edge, "touchmove", 50, 400, 40);
      touch(edge, "touchmove", 95, 400, 80);
      touch(edge, "touchend", 95, 400, 1080);

      expect(sidebarMode()).toBe("hidden");
    });

    it("takes the left edge from the host while it can be pulled from there", async () => {
      mockClaimLeftEdge.mockClear();
      mockReleaseLeftEdge.mockClear();
      await renderDrawer(false);

      expect(mockClaimLeftEdge).toHaveBeenCalledWith(window.ERATO_SHELL);
      expect(mockReleaseLeftEdge).not.toHaveBeenCalled();

      cleanup();
      expect(mockReleaseLeftEdge).toHaveBeenCalledTimes(1);
    });

    it("opens on a short flick", async () => {
      await renderDrawer(false);
      const edge = screen.getByTestId("sidebar-edge");

      touch(edge, "touchstart", 5, 400, 0);
      touch(edge, "touchmove", 40, 400, 40);
      touch(edge, "touchmove", 80, 400, 80);
      touch(edge, "touchend", 80, 400, 90);
      runFrames(2);

      expect(sidebarMode()).toBe("expanded");
    });

    it("closes when dragged left on the drawer or on the dimmed page", async () => {
      await renderDrawer(true);

      drag(drawer(), 250, 60, 600);
      expect(sidebarMode()).toBe("hidden");

      fireEvent.click(screen.getByRole("button", { name: "expand sidebar" }));
      expect(sidebarMode()).toBe("expanded");

      drag(screen.getByTestId("sidebar-scrim"), 350, 150, 600);
      expect(sidebarMode()).toBe("hidden");
    });

    it("leaves a vertical drag in the drawer to the list's scrolling", async () => {
      await renderDrawer(true);
      const target = drawer();

      touch(target, "touchstart", 200, 400, 0);
      const first = touch(target, "touchmove", 196, 380, 20);
      const later = touch(target, "touchmove", 120, 300, 200);
      touch(target, "touchend", 120, 300, 400);

      expect(first.defaultPrevented).toBe(false);
      expect(later.defaultPrevented).toBe(false);
      expect(drawer().style.transform).toBe("");
      expect(sidebarMode()).toBe("expanded");
    });

    it("settles at once when the person asks for reduced motion", async () => {
      const matchMedia = window.matchMedia;
      window.matchMedia = (query: string) => ({
        ...matchMedia(query),
        matches: query.includes("prefers-reduced-motion"),
      });
      try {
        await renderDrawer(true);

        drag(drawer(), 250, 200, 600);

        expect(drawer().style.transition).toContain("transform 0ms");
        expect(sidebarMode()).toBe("expanded");
      } finally {
        window.matchMedia = matchMedia;
      }
    });

    it("offers no edge in a browser, where the edge swipe is the browser's", async () => {
      delete window.ERATO_SHELL;
      await renderDrawer(true);

      expect(screen.queryByTestId("sidebar-edge")).not.toBeInTheDocument();
      drag(drawer(), 250, 60, 600);
      expect(sidebarMode()).toBe("hidden");
    });

    it("changes nothing on a wide screen", async () => {
      mockedNarrowScreen = false;
      await renderDrawer(true);

      expect(screen.queryByTestId("sidebar-edge")).not.toBeInTheDocument();
      const move = drag(drawer(), 250, 60, 600);

      expect(move.defaultPrevented).toBe(false);
      expect(drawer().style.transform).toBe("");
      expect(sidebarMode()).toBe("expanded");
    });

    describe("out of reach beside the open drawer", () => {
      const expandToggle = () =>
        screen.getByRole("button", { name: "expand sidebar" });
      const collapseToggle = () =>
        screen.getByRole("button", { name: "collapse sidebar" });

      it("takes the pushed page out of reach and the hidden drawer with it", async () => {
        await renderDrawer(true);
        expect(page()).toHaveAttribute("inert");
        expect(drawer()).not.toHaveAttribute("inert");

        fireEvent.click(collapseToggle());

        expect(page()).not.toHaveAttribute("inert");
        expect(drawer()).toHaveAttribute("inert");
      });

      it.each([
        [
          "a tap beside it",
          () => fireEvent.click(screen.getByTestId("sidebar-scrim")),
        ],
        ["Escape", () => fireEvent.keyDown(document.body, { key: "Escape" })],
        [
          "a drag",
          () => drag(screen.getByTestId("sidebar-scrim"), 350, 60, 600),
        ],
      ])("gives the page back on %s", async (_, close) => {
        await renderDrawer(true);

        close();

        expect(sidebarMode()).toBe("hidden");
        expect(page()).not.toHaveAttribute("inert");
        expect(page()).not.toHaveAttribute("aria-hidden");
      });

      it("takes the page out of reach once a drag from the edge opens the drawer", async () => {
        await renderDrawer(false);
        expect(page()).not.toHaveAttribute("inert");

        drag(screen.getByTestId("sidebar-edge"), 5, 250, 600);

        expect(sidebarMode()).toBe("expanded");
        expect(page()).toHaveAttribute("inert");
      });

      it("moves focus into the drawer on open and back to the toggle on close", async () => {
        await renderDrawer(false);
        expandToggle().focus();

        fireEvent.click(expandToggle());
        await waitFor(() => expect(collapseToggle()).toHaveFocus());

        fireEvent.click(collapseToggle());
        await waitFor(() => expect(expandToggle()).toHaveFocus());
      });

      it("hands focus dropped by the page to the toggle on close", async () => {
        await renderDrawer(true);
        (document.activeElement as HTMLElement | null)?.blur();

        drag(screen.getByTestId("sidebar-scrim"), 350, 60, 600);

        await waitFor(() => expect(expandToggle()).toHaveFocus());
      });

      it("gives the page back after a chat is picked in the drawer", async () => {
        await renderDrawer(true);
        screen.getByRole("link", { name: "Search" }).focus();

        act(() => {
          historyListProps.at(-1)?.onSessionSelect?.("chat-2");
        });

        expect(sidebarMode()).toBe("hidden");
        expect(page()).not.toHaveAttribute("inert");
        await waitFor(() => expect(expandToggle()).toHaveFocus());
      });

      it("hides the page from screen readers where a browser has no inert", async () => {
        await renderDrawer(true);

        expect(page().getAttribute("aria-hidden")).toBe(
          "inert" in HTMLElement.prototype ? null : "true",
        );
      });

      it("moves no focus when the drawer is already open on arrival", async () => {
        const before = document.activeElement;

        await renderDrawer(true);

        expect(document.activeElement).toBe(before);
      });

      it("leaves the page reachable on a wide screen", async () => {
        mockedNarrowScreen = false;
        await renderDrawer(true);

        expect(page()).not.toHaveAttribute("inert");
        expect(page()).not.toHaveAttribute("aria-hidden");
        expect(drawer()).not.toHaveAttribute("inert");
      });
    });
  });
});
