import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

import {
  useArchiveChatEndpoint,
  useUpdateChat,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import {
  useChatHistory,
  useChatHistoryStore,
  clearPendingChat,
  deriveTitleHint,
  isPendingChat,
} from "../useChatHistory";

import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const mockUseInfiniteQuery = vi.hoisted(() => vi.fn());

const mockNavigate = vi.fn();
let mockLocation = { pathname: "/chat" };
let mockParams: { id?: string; chatId?: string } = {};

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => mockLocation,
    useParams: () => mockParams,
  };
});

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchRecentChats: vi.fn(),
  useArchiveChatEndpoint: vi.fn(),
  useUpdateChat: vi.fn(),
  chatMessagesQuery: vi.fn((variables: { pathParams: { chatId: string } }) => ({
    queryKey: ["chatMessages", { chatId: variables.pathParams.chatId }],
  })),
  recentChatsQuery: vi.fn(() => ({ queryKey: ["recentChats"] })),
}));

vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: mockUseInfiniteQuery,
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
  }),
}));

const listedChat = (id: string): RecentChat => ({
  id,
  title_resolved: `Title of ${id}`,
  can_edit: true,
  file_uploads: [],
  last_message_at: "2026-01-01T12:00:00.000Z",
  last_selected_facets: ["listed-facet"],
});

const setListedChats = (chats: RecentChat[]) => {
  mockUseInfiniteQuery.mockReturnValue({
    data: {
      pages: [
        {
          chats,
          stats: {
            total_count: chats.length,
            returned_count: chats.length,
            current_offset: 0,
            has_more: false,
          },
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  });
};

const PENDING_ID = "11111111-2222-3333-4444-555555555555";
const pending = { id: PENDING_ID, createdAt: "2026-02-02T08:00:00.000Z" };

describe("useChatHistory pending chat placeholder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation = { pathname: "/chat" };
    mockParams = {};

    useChatHistoryStore.setState({
      pendingChat: null,
      isNewChatPending: false,
    });

    setListedChats([listedChat("listed-1")]);
    vi.mocked(useArchiveChatEndpoint).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
    } as unknown as ReturnType<typeof useArchiveChatEndpoint>);
    vi.mocked(useUpdateChat).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
    } as unknown as ReturnType<typeof useUpdateChat>);
  });

  it("prepends a placeholder row for a chat the list does not have yet", () => {
    const { result } = renderHook(() => useChatHistory());

    expect(result.current.chats.map((chat) => chat.id)).toEqual(["listed-1"]);

    act(() => {
      useChatHistoryStore.getState().setPendingChat(pending);
    });

    expect(result.current.chats.map((chat) => chat.id)).toEqual([
      PENDING_ID,
      "listed-1",
    ]);
    expect(result.current.chats[0]).toMatchObject({
      id: PENDING_ID,
      title_resolved: "",
      can_edit: false,
      file_uploads: [],
      last_message_at: pending.createdAt,
    });
  });

  it("does not prepend a placeholder once the chat is listed", () => {
    const { result, rerender } = renderHook(() => useChatHistory());

    act(() => {
      useChatHistoryStore.getState().setPendingChat(pending);
    });
    expect(result.current.chats).toHaveLength(2);

    setListedChats([listedChat(PENDING_ID), listedChat("listed-1")]);
    rerender();

    expect(result.current.chats.map((chat) => chat.id)).toEqual([
      PENDING_ID,
      "listed-1",
    ]);
    expect(result.current.chats[0].title_resolved).toBe(
      `Title of ${PENDING_ID}`,
    );
    // The placeholder is dropped rather than kept around, so it cannot outrank
    // the list again after the real row leaves it.
    expect(useChatHistoryStore.getState().pendingChat).toBeNull();
  });

  it("leaves the first turn's facets and model unresolved on the placeholder", () => {
    const { result } = renderHook(() => useChatHistory());

    act(() => {
      useChatHistoryStore.getState().setPendingChat(pending);
    });

    const placeholder = result.current.chats[0];
    expect(placeholder.last_selected_facets).toBeUndefined();
    expect(placeholder.last_model).toBeUndefined();
  });

  it("carries the assistant id when the chat was started from an assistant", () => {
    const { result } = renderHook(() => useChatHistory());

    act(() => {
      useChatHistoryStore.getState().setPendingChat(pending);
    });
    expect(result.current.chats[0].assistant_id).toBeUndefined();

    act(() => {
      useChatHistoryStore
        .getState()
        .setPendingChat({ ...pending, assistantId: "assistant-7" });
    });
    expect(result.current.chats[0].assistant_id).toBe("assistant-7");
  });

  it("clears the placeholder only for the chat it is scoped to", () => {
    act(() => {
      useChatHistoryStore.getState().setPendingChat(pending);
    });

    expect(isPendingChat(PENDING_ID)).toBe(true);
    expect(isPendingChat("some-other-chat")).toBe(false);

    clearPendingChat("some-other-chat");
    expect(useChatHistoryStore.getState().pendingChat).toEqual(pending);

    clearPendingChat(PENDING_ID);
    expect(useChatHistoryStore.getState().pendingChat).toBeNull();
  });
});

describe("deriveTitleHint", () => {
  it("returns short messages unchanged with whitespace collapsed", () => {
    expect(deriveTitleHint("  Plan the\n offsite ")).toBe("Plan the offsite");
  });

  it("returns null for whitespace-only input", () => {
    expect(deriveTitleHint("   \n\t ")).toBeNull();
  });

  it("truncates long messages at a word boundary with an ellipsis", () => {
    const hint = deriveTitleHint(
      "Summarize the attached meeting notes and draft a follow-up email for the team",
    );
    expect(hint).toBe("Summarize the attached meeting notes…");
    expect(hint!.length).toBeLessThanOrEqual(41);
  });

  it("hard-cuts a single overlong word", () => {
    expect(deriveTitleHint("a".repeat(60))).toBe(`${"a".repeat(40)}…`);
  });
});
