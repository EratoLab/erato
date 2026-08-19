import { i18n, type Messages } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchRecentChats } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { messages as enMessages } from "@/locales/en/messages.json";
import { useChatContext } from "@/providers/ChatProvider";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import SearchPage from "../SearchPage";

import "@testing-library/jest-dom";

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

const renderPage = () =>
  render(
    <StaticFeatureConfigProvider>
      <I18nProvider i18n={i18n}>
        <MemoryRouter initialEntries={["/search"]}>
          <SearchPage />
        </MemoryRouter>
      </I18nProvider>
    </StaticFeatureConfigProvider>,
  );

describe("SearchPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
