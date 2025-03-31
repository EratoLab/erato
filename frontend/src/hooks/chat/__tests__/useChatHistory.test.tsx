import { renderHook, act } from "@testing-library/react";
import { useChatHistory } from "../useChatHistory";
import { useChats } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useRouter } from "next/navigation";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";

// Mock dependencies
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useChats: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

// Mock implementations
const mockUseChats = useChats as unknown as ReturnType<typeof vi.fn>;
const mockUseRouter = useRouter as unknown as ReturnType<typeof vi.fn>;

// Create a wrapper with QueryClientProvider
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

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
    const { result } = renderHook(() => useChatHistory(), {
      wrapper: createWrapper(),
    });

    expect(result.current.chats).toEqual(mockChats);
    expect(result.current.isLoading).toBe(false);
  });

  it("should navigate to a specific chat", () => {
    const { result } = renderHook(() => useChatHistory(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.navigateToChat("chat1");
    });

    expect(mockRouter.push).toHaveBeenCalledWith("/chat/chat1");
    expect(result.current.currentChatId).toBe("chat1");
  });

  it("should create a new chat", async () => {
    const { result } = renderHook(() => useChatHistory(), {
      wrapper: createWrapper(),
    });

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

    const { result } = renderHook(() => useChatHistory(), {
      wrapper: createWrapper(),
    });

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

    const { result } = renderHook(() => useChatHistory(), {
      wrapper: createWrapper(),
    });

    expect(result.current.error).toBe(testError);
  });
});
