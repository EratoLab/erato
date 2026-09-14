import { i18n, type Messages } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useToastStore } from "@/components/ui/Toast/toastStore";
import {
  CHAT_HISTORY_FILTER_DEFAULTS,
  useChatHistoryFilterStore,
} from "@/hooks/chat/store/chatHistoryFilterStore";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { fetchRecentChats } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { messages as enMessages } from "@/locales/en/messages.json";
import { useChatContext } from "@/providers/ChatProvider";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import SearchPage from "../SearchPage";

import "@testing-library/jest-dom";

import type { ComponentProps, ReactNode } from "react";

i18n.load("en", enMessages as unknown as Messages);
i18n.activate("en");

const mockUseInfiniteQuery = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", async () => ({
  ...(await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  )),
  useInfiniteQuery: mockUseInfiniteQuery,
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchRecentChats: vi.fn(),
  // Echoes the params into the key the way the generated builder does, so the
  // cache key is covered as well as the request.
  recentChatsQuery: vi.fn(
    (variables: { queryParams?: Record<string, unknown> }) => ({
      queryKey: ["recentChats", variables.queryParams ?? {}],
    }),
  ),
}));

vi.mock("@/providers/ChatProvider", () => ({
  useChatContext: vi.fn(),
}));

vi.mock("@/components/ui/Chat/ChatShareDialog", () => ({
  ChatShareDialog: () => null,
}));

vi.mock("@/components/ui/Chat/EditChatTitleDialog", () => ({
  EditChatTitleDialog: () => null,
}));

vi.mock("@/components/ui/Controls/DropdownMenu", () => ({
  DropdownMenu: ({
    items,
  }: {
    items: Array<{
      label: ReactNode;
      onClick?: () => void;
      confirmAction?: boolean;
      confirmMessage?: string;
    }>;
  }) => (
    <div data-testid="result-menu">
      {items.map((item) => (
        <button
          key={String(item.label)}
          type="button"
          onClick={item.onClick}
          data-confirms={item.confirmAction ? "" : undefined}
          data-confirm-message={item.confirmMessage}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/hooks/ui", () => ({
  usePageAlignment: () => ({
    alignment: "center",
    maxWidth: "4xl",
    maxWidthClass: "max-w-4xl",
    containerClasses: "max-w-4xl mx-auto",
    textAlignment: "text-center",
    flexAlignment: "items-center",
    justifyAlignment: "justify-center",
    horizontalPadding: "px-6",
  }),
}));

const renderPage = (
  config?: ComponentProps<typeof StaticFeatureConfigProvider>["config"],
) =>
  render(
    <StaticFeatureConfigProvider config={config}>
      <I18nProvider i18n={i18n}>
        <MemoryRouter initialEntries={["/search"]}>
          <SearchPage />
        </MemoryRouter>
      </I18nProvider>
    </StaticFeatureConfigProvider>,
  );

const recentChat = (overrides: {
  id: string;
  archived_at?: string;
  last_message_at?: string;
}) => ({
  assistant_id: undefined,
  title_resolved: overrides.id,
  title_by_summary: null,
  title_by_user_provided: null,
  can_edit: true,
  is_pinned: false,
  last_message_at: "2024-01-01T00:00:00Z",
  ...overrides,
});

const pageOf = (chats: ReturnType<typeof recentChat>[]) => ({
  data: {
    pages: [
      {
        chats,
        stats: {
          has_more: false,
          returned_count: chats.length,
          current_offset: 0,
          total_count: chats.length,
        },
      },
    ],
  },
  isLoading: false,
  isFetching: false,
  isFetchingNextPage: false,
  hasNextPage: false,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
  error: null,
});

const allFeaturesOn = {
  pinnedChats: { enabled: true },
  chatSharing: { enabled: true },
};

describe("SearchPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatHistoryFilterStore.setState({ ...CHAT_HISTORY_FILTER_DEFAULTS });
    useGenerationStatusStore.setState({
      statusByChatId: {},
      currentChatId: null,
    });
    useToastStore.getState().clear();
    mockUseInfiniteQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      error: null,
    });
    vi.mocked(useChatContext).mockReturnValue({
      archiveChat: vi.fn(),
      unarchiveChat: vi.fn(),
      updateChatTitle: vi.fn(),
      refetchHistory: vi.fn(),
      pinChat: vi.fn(),
      pinnedChats: [],
    } as unknown as ReturnType<typeof useChatContext>);
  });

  it("never opts into delegated runs", () => {
    renderPage();

    const [{ queryKey, queryFn }] = mockUseInfiniteQuery.mock.calls[0] as [
      {
        queryKey: unknown[];
        queryFn: (context: { pageParam: number }) => unknown;
      },
    ];
    queryFn({ pageParam: 0 });

    for (const part of queryKey) {
      expect(part).not.toHaveProperty("include_delegated");
    }
    expect(
      vi.mocked(fetchRecentChats).mock.calls[0][0].queryParams,
    ).not.toHaveProperty("include_delegated");
  });

  const lastRequest = () => {
    const [{ queryKey, queryFn }] = mockUseInfiniteQuery.mock.calls.at(-1) as [
      {
        queryKey: unknown[];
        queryFn: (context: { pageParam: number }) => unknown;
      },
    ];
    queryFn({ pageParam: 0 });
    return {
      queryKey,
      queryParams: vi.mocked(fetchRecentChats).mock.calls.at(-1)?.[0]
        .queryParams as Record<string, unknown>,
    };
  };

  it("lists only active chats under the sidebar's default status filter", () => {
    renderPage();

    const { queryKey, queryParams } = lastRequest();
    for (const part of queryKey) {
      expect(part).not.toHaveProperty("include_archived");
    }
    expect(queryParams).not.toHaveProperty("include_archived");
  });

  it("asks for archived chats in key and request once the sidebar shows all", () => {
    renderPage();
    act(() => {
      useChatHistoryFilterStore.setState({ statusFilter: "all" });
    });

    const { queryKey, queryParams } = lastRequest();
    expect(queryKey).toContainEqual(
      expect.objectContaining({ include_archived: true }),
    );
    expect(queryParams).toHaveProperty("include_archived", true);
  });

  it("offers Unarchive and Rename alone on an archived result", () => {
    mockUseInfiniteQuery.mockReturnValue(
      pageOf([
        recentChat({
          id: "archived-1",
          archived_at: "2024-02-01T00:00:00Z",
          last_message_at: "2024-02-02T00:00:00Z",
        }),
        recentChat({ id: "active-1" }),
      ]),
    );

    renderPage(allFeaturesOn);

    const [archivedMenu, activeMenu] = screen.getAllByTestId("result-menu");

    expect(
      within(archivedMenu).getByRole("button", { name: "Unarchive" }),
    ).toBeInTheDocument();
    expect(
      within(archivedMenu).getByRole("button", { name: "Rename" }),
    ).toBeInTheDocument();
    for (const name of ["Archive", "Pin", "Share"]) {
      expect(
        within(archivedMenu).queryByRole("button", { name }),
      ).not.toBeInTheDocument();
    }

    for (const name of ["Archive", "Pin", "Share"]) {
      expect(
        within(activeMenu).getByRole("button", { name }),
      ).toBeInTheDocument();
    }
    expect(
      within(activeMenu).queryByRole("button", { name: "Unarchive" }),
    ).not.toBeInTheDocument();
  });

  it("unarchives through the context and refreshes the search results", async () => {
    const unarchiveChat = vi.fn(async () => undefined);
    const refetchHistory = vi.fn(async () => undefined);
    vi.mocked(useChatContext).mockReturnValue({
      archiveChat: vi.fn(),
      unarchiveChat,
      updateChatTitle: vi.fn(),
      refetchHistory,
      pinChat: vi.fn(),
      pinnedChats: [],
    } as unknown as ReturnType<typeof useChatContext>);
    const page = pageOf([
      recentChat({ id: "archived-1", archived_at: "2024-02-01T00:00:00Z" }),
    ]);
    mockUseInfiniteQuery.mockReturnValue(page);

    renderPage(allFeaturesOn);
    fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));

    await waitFor(() =>
      expect(unarchiveChat).toHaveBeenCalledWith("archived-1"),
    );
    await waitFor(() => expect(page.refetch).toHaveBeenCalled());
    expect(refetchHistory).toHaveBeenCalled();
  });

  it("marks an archived result in its accessible name", () => {
    mockUseInfiniteQuery.mockReturnValue(
      pageOf([
        recentChat({
          id: "archived-1",
          archived_at: "2024-02-01T00:00:00Z",
          last_message_at: "2024-02-02T00:00:00Z",
        }),
        recentChat({ id: "active-1" }),
      ]),
    );

    renderPage(allFeaturesOn);

    expect(screen.getAllByTestId("chat-history-item-archived")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "archived-1, Archived" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "active-1" })).toBeInTheDocument();
  });

  it("warns before archiving a result that is still generating", () => {
    mockUseInfiniteQuery.mockReturnValue(
      pageOf([recentChat({ id: "running-1" }), recentChat({ id: "idle-1" })]),
    );
    useGenerationStatusStore.setState({
      statusByChatId: {
        "running-1": {
          kind: "running",
          startedAt: new Date().toISOString(),
          localSeenAt: Date.now(),
        },
      },
      currentChatId: null,
    });

    renderPage(allFeaturesOn);

    const [runningMenu, idleMenu] = screen.getAllByTestId("result-menu");
    const runningArchive = within(runningMenu).getByRole("button", {
      name: "Archive",
    });
    expect(runningArchive).toHaveAttribute("data-confirms");
    expect(runningArchive.getAttribute("data-confirm-message")).toContain(
      "still generating",
    );
    expect(
      within(idleMenu).getByRole("button", { name: "Archive" }),
    ).not.toHaveAttribute("data-confirms");
  });

  it("toasts when unarchiving fails", async () => {
    vi.mocked(useChatContext).mockReturnValue({
      archiveChat: vi.fn(),
      unarchiveChat: vi.fn(() => Promise.reject(new Error("nope"))),
      updateChatTitle: vi.fn(),
      refetchHistory: vi.fn(),
      pinChat: vi.fn(),
      pinnedChats: [],
    } as unknown as ReturnType<typeof useChatContext>);
    mockUseInfiniteQuery.mockReturnValue(
      pageOf([
        recentChat({ id: "archived-1", archived_at: "2024-02-01T00:00:00Z" }),
      ]),
    );

    renderPage(allFeaturesOn);
    fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));

    await waitFor(() =>
      expect(useToastStore.getState().toasts).toHaveLength(1),
    );
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      variant: "error",
    });
  });
});
