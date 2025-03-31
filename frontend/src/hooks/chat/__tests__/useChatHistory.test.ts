import { renderHook, act } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { vi, describe, it, expect, beforeEach } from "vitest";

import { useChats } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { useChatHistory } from "../useChatHistory";

// Mock dependencies
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useChats: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock implementations
const mockUseChats = useChats as unknown as ReturnType<typeof vi.fn>;
const mockUseRouter = useRouter as unknown as ReturnType<typeof vi.fn>;

describe("useChatHistory", () => {
  // Mock chat data
  const mockChats = [
    { id: "chat1", title: "Chat 1" },
    { id: "chat2", title: "Chat 2" },
  ];

  // Mock router
  const mockRouter = {
    push: vi.fn(),
  };

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Default mock implementations
    mockUseChats.mockReturnValue({
      data: mockChats,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    mockUseRouter.mockReturnValue(mockRouter);
  });

  it("should fetch chats", () => {
    const { result } = renderHook(() => useChatHistory());

    expect(result.current.chats).toEqual(mockChats);
    expect(result.current.isLoading).toBe(false);
  });

  it("should navigate to a specific chat", () => {
    const { result } = renderHook(() => useChatHistory());

    act(() => {
      result.current.navigateToChat("chat1");
    });

    expect(mockRouter.push).toHaveBeenCalledWith("/chat/chat1");
    expect(result.current.currentChatId).toBe("chat1");
  });

  it("should create a new chat", async () => {
    const { result } = renderHook(() => useChatHistory());

    await act(async () => {
      await result.current.createNewChat();
    });

    expect(mockRouter.push).toHaveBeenCalledWith("/chat/new");
  });

  it("should handle loading state", () => {
    mockUseChats.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useChatHistory());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.chats).toBeUndefined();
  });

  it("should handle errors", () => {
    const testError = new Error("Failed to fetch chats");

    mockUseChats.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: testError,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useChatHistory());

    expect(result.current.error).toBe(testError);
  });
});
