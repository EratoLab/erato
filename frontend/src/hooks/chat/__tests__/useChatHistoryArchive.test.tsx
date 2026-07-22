import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: "/chat" }),
    useParams: () => ({}),
  };
});

const mockArchiveMutation = vi.fn();
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchRecentChats: vi.fn(),
  useArchiveChatEndpoint: () => ({ mutateAsync: mockArchiveMutation }),
  useUpdateChat: () => ({ mutateAsync: vi.fn() }),
  recentChatsQuery: () => ({ queryKey: ["recentChats"] }),
  chatMessagesQuery: (v: { pathParams: { chatId: string } }) => ({
    queryKey: ["chatMessages", { chatId: v.pathParams.chatId }],
  }),
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiContext", () => ({
  useV1betaApiContext: () => ({ fetcherOptions: {} }),
}));

import { useChatHistory } from "../useChatHistory";

const CHAT_HISTORY_PAGE_SIZE = 30;
const queryKey = ["recentChats", "infinite", { limit: CHAT_HISTORY_PAGE_SIZE }];

function makePage(offset: number, ids: string[], hasMore: boolean) {
  return {
    chats: ids.map((id) => ({ id, title_resolved: id })),
    stats: {
      current_offset: offset,
      returned_count: ids.length,
      has_more: hasMore,
      total_count: 45,
    },
  };
}

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: queryClient }, children);

describe("useChatHistory archiveChat optimistic removal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockArchiveMutation.mockResolvedValue(undefined);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      },
    });

    // Seed two loaded pages. Page 0: chat0..chat29, Page 1: chat30..chat44.
    const page0Ids = Array.from({ length: 30 }, (_, i) => `chat${i}`);
    const page1Ids = Array.from({ length: 15 }, (_, i) => `chat${i + 30}`);
    queryClient.setQueryData(queryKey, {
      pageParams: [0, 30],
      pages: [makePage(0, page0Ids, true), makePage(30, page1Ids, false)],
    });
  });

  it("removes exactly one row and no other chat disappears (2+ pages)", async () => {
    const { result } = renderHook(() => useChatHistory(), { wrapper });

    expect(result.current.chats).toHaveLength(45);

    await act(async () => {
      await result.current.archiveChat("chat5");
    });

    await waitFor(() => expect(result.current.chats).toHaveLength(44));

    const ids = result.current.chats.map((c) => c.id);
    expect(ids).not.toContain("chat5");
    // The chat that straddled the page boundary must still be present.
    expect(ids).toContain("chat29");
    expect(ids).toContain("chat30");
    // No duplicates.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not refetch the list (no invalidate)", async () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useChatHistory(), { wrapper });

    await act(async () => {
      await result.current.archiveChat("chat5");
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("rolls back the removal if the mutation fails", async () => {
    mockArchiveMutation.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useChatHistory(), { wrapper });

    await act(async () => {
      await expect(result.current.archiveChat("chat5")).rejects.toThrow("boom");
    });

    await waitFor(() => expect(result.current.chats).toHaveLength(45));
    expect(result.current.chats.map((c) => c.id)).toContain("chat5");
  });
});
