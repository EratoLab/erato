import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChatDisabledMcpTools } from "../useChatDisabledMcpTools";

import type { ChatDetail } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

const mockUseChatDetail = vi.fn();
const mockUpdateChat = vi.fn();

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useChatDetail: (...args: unknown[]) => mockUseChatDetail(...args),
  useUpdateChat: () => ({ mutateAsync: mockUpdateChat, isPending: false }),
  chatDetailQuery: (variables: { pathParams: { chatId: string } }) => ({
    queryKey: ["me", "chats", variables.pathParams.chatId],
  }),
  recentChatsQuery: () => ({ queryKey: ["me", "recent_chats"] }),
}));

const chatDetail = (disabledMcpTools: string[]): ChatDetail => ({
  id: "chat-1",
  title_resolved: "Chat",
  is_pinned: false,
  mcp_write_tools_enabled: true,
  disabled_mcp_server_ids: ["github"],
  disabled_mcp_tools: disabledMcpTools,
  can_edit: true,
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

const renderDisabledTools = (chatId: string | null) =>
  renderHook(
    ({ id }: { id: string | null }) =>
      useChatDisabledMcpTools({ chatId: id, isAvailable: true }),
    { wrapper, initialProps: { id: chatId } },
  );

describe("useChatDisabledMcpTools", () => {
  beforeEach(() => {
    mockUseChatDetail.mockReset();
    mockUpdateChat.mockReset();
    mockUseChatDetail.mockReturnValue({ data: undefined });
    mockUpdateChat.mockResolvedValue({});
  });

  it("keeps a new chat's list locally as exact server/tool entries and hands it to the first send only while non-empty", () => {
    const { result } = renderDisabledTools(null);

    expect(result.current.disabledToolPatterns).toEqual([]);
    expect(result.current.newChatSeed).toBeUndefined();

    act(() => result.current.toggleTool("linear", "create_issue"));
    act(() => result.current.toggleTool("linear", "delete_issue"));

    expect(result.current.disabledToolPatterns).toEqual([
      "linear/create_issue",
      "linear/delete_issue",
    ]);
    expect(result.current.newChatSeed).toEqual([
      "linear/create_issue",
      "linear/delete_issue",
    ]);
    expect(mockUpdateChat).not.toHaveBeenCalled();

    act(() => result.current.toggleTool("linear", "create_issue"));
    expect(result.current.newChatSeed).toEqual(["linear/delete_issue"]);
    act(() => result.current.toggleTool("linear", "delete_issue"));
    expect(result.current.newChatSeed).toBeUndefined();
  });

  it("reads an existing chat's list from its row and writes the whole list back, leaving the server list alone", async () => {
    mockUseChatDetail.mockReturnValue({
      data: chatDetail(["github/create_issue"]),
    });
    const { result } = renderDisabledTools("chat-1");

    expect(result.current.disabledToolPatterns).toEqual([
      "github/create_issue",
    ]);
    expect(result.current.newChatSeed).toBeUndefined();

    act(() => result.current.toggleTool("linear", "create_issue"));

    // Optimistic: the row reads off before the server answers.
    expect(result.current.disabledToolPatterns).toEqual([
      "github/create_issue",
      "linear/create_issue",
    ]);
    await waitFor(() =>
      expect(mockUpdateChat).toHaveBeenCalledWith({
        pathParams: { chatId: "chat-1" },
        body: {
          disabled_mcp_tools: ["github/create_issue", "linear/create_issue"],
        },
      }),
    );
  });

  it("re-enables a tool by sending the list without it", async () => {
    mockUseChatDetail.mockReturnValue({
      data: chatDetail(["github/create_issue", "linear/create_issue"]),
    });
    const { result } = renderDisabledTools("chat-1");

    act(() => result.current.toggleTool("github", "create_issue"));

    expect(result.current.disabledToolPatterns).toEqual([
      "linear/create_issue",
    ]);
    await waitFor(() =>
      expect(mockUpdateChat).toHaveBeenCalledWith({
        pathParams: { chatId: "chat-1" },
        body: { disabled_mcp_tools: ["linear/create_issue"] },
      }),
    );
  });

  it("falls back to the row's list when the update fails", async () => {
    mockUseChatDetail.mockReturnValue({ data: chatDetail([]) });
    mockUpdateChat.mockRejectedValue(new Error("boom"));
    const { result } = renderDisabledTools("chat-1");

    act(() => result.current.toggleTool("linear", "create_issue"));
    expect(result.current.disabledToolPatterns).toEqual([
      "linear/create_issue",
    ]);

    await waitFor(() =>
      expect(result.current.disabledToolPatterns).toEqual([]),
    );
  });

  it("locks the switches and drops a flip while an existing chat's row is not in yet", async () => {
    const { result, rerender } = renderDisabledTools("chat-1");

    expect(result.current.isReady).toBe(false);
    act(() => result.current.toggleTool("linear", "create_issue"));
    expect(result.current.disabledToolPatterns).toEqual([]);
    expect(mockUpdateChat).not.toHaveBeenCalled();

    mockUseChatDetail.mockReturnValue({
      data: chatDetail(["github/create_issue"]),
    });
    rerender({ id: "chat-1" });
    expect(result.current.isReady).toBe(true);

    act(() => result.current.toggleTool("linear", "create_issue"));
    await waitFor(() =>
      expect(mockUpdateChat).toHaveBeenCalledWith({
        pathParams: { chatId: "chat-1" },
        body: {
          disabled_mcp_tools: ["github/create_issue", "linear/create_issue"],
        },
      }),
    );
  });

  it("keeps showing the seeded list across the new chat's rename and resets on the next new chat", () => {
    const { result, rerender } = renderDisabledTools(null);

    act(() => result.current.toggleTool("linear", "create_issue"));
    expect(result.current.disabledToolPatterns).toEqual([
      "linear/create_issue",
    ]);

    rerender({ id: "chat-1" });
    expect(result.current.disabledToolPatterns).toEqual([
      "linear/create_issue",
    ]);
    expect(result.current.newChatSeed).toBeUndefined();
    expect(result.current.isReady).toBe(false);

    mockUseChatDetail.mockReturnValue({ data: undefined });
    rerender({ id: null });
    expect(result.current.disabledToolPatterns).toEqual([]);
    expect(result.current.newChatSeed).toBeUndefined();
  });

  it("does not fetch the row while the switches are not offered", () => {
    renderHook(
      () => useChatDisabledMcpTools({ chatId: "chat-1", isAvailable: false }),
      { wrapper },
    );

    expect(mockUseChatDetail).toHaveBeenCalledWith(
      expect.any(Symbol),
      expect.anything(),
    );
  });
});
