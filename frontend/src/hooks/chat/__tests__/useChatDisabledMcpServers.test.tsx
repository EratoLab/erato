import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChatDisabledMcpServers } from "../useChatDisabledMcpServers";

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

const chatDetail = (disabledMcpServerIds: string[]): ChatDetail => ({
  id: "chat-1",
  title_resolved: "Chat",
  is_pinned: false,
  mcp_write_tools_enabled: true,
  disabled_mcp_server_ids: disabledMcpServerIds,
  can_edit: true,
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

const renderDisabledServers = (chatId: string | null) =>
  renderHook(
    ({ id }: { id: string | null }) =>
      useChatDisabledMcpServers({ chatId: id, isAvailable: true }),
    { wrapper, initialProps: { id: chatId } },
  );

describe("useChatDisabledMcpServers", () => {
  beforeEach(() => {
    mockUseChatDetail.mockReset();
    mockUpdateChat.mockReset();
    mockUseChatDetail.mockReturnValue({ data: undefined });
    mockUpdateChat.mockResolvedValue({});
  });

  it("keeps a new chat's list locally and hands it to the first send only while non-empty", () => {
    const { result } = renderDisabledServers(null);

    expect(result.current.disabledServerIds).toEqual([]);
    expect(result.current.newChatSeed).toBeUndefined();

    act(() => result.current.toggleServer("linear"));
    act(() => result.current.toggleServer("github"));

    expect(result.current.disabledServerIds).toEqual(["linear", "github"]);
    expect(result.current.newChatSeed).toEqual(["linear", "github"]);
    expect(mockUpdateChat).not.toHaveBeenCalled();

    act(() => result.current.toggleServer("linear"));
    expect(result.current.newChatSeed).toEqual(["github"]);
    act(() => result.current.toggleServer("github"));
    expect(result.current.newChatSeed).toBeUndefined();
  });

  it("reads an existing chat's list from its row and writes the whole list back through the update endpoint", async () => {
    mockUseChatDetail.mockReturnValue({ data: chatDetail(["github"]) });
    const { result } = renderDisabledServers("chat-1");

    expect(result.current.disabledServerIds).toEqual(["github"]);
    expect(result.current.newChatSeed).toBeUndefined();

    act(() => result.current.toggleServer("linear"));

    // Optimistic: the row reads off before the server answers.
    expect(result.current.disabledServerIds).toEqual(["github", "linear"]);
    await waitFor(() =>
      expect(mockUpdateChat).toHaveBeenCalledWith({
        pathParams: { chatId: "chat-1" },
        body: { disabled_mcp_server_ids: ["github", "linear"] },
      }),
    );
  });

  it("re-enables a server by sending the list without it", async () => {
    mockUseChatDetail.mockReturnValue({
      data: chatDetail(["github", "linear"]),
    });
    const { result } = renderDisabledServers("chat-1");

    act(() => result.current.toggleServer("github"));

    expect(result.current.disabledServerIds).toEqual(["linear"]);
    await waitFor(() =>
      expect(mockUpdateChat).toHaveBeenCalledWith({
        pathParams: { chatId: "chat-1" },
        body: { disabled_mcp_server_ids: ["linear"] },
      }),
    );
  });

  it("falls back to the row's list when the update fails", async () => {
    mockUseChatDetail.mockReturnValue({ data: chatDetail([]) });
    mockUpdateChat.mockRejectedValue(new Error("boom"));
    const { result } = renderDisabledServers("chat-1");

    act(() => result.current.toggleServer("linear"));
    expect(result.current.disabledServerIds).toEqual(["linear"]);

    await waitFor(() => expect(result.current.disabledServerIds).toEqual([]));
  });

  it("locks the switches and drops a flip while an existing chat's row is not in yet", async () => {
    const { result, rerender } = renderDisabledServers("chat-1");

    // The PUT replaces the whole list: built from anything but the row, it
    // would re-enable every server the row already holds.
    expect(result.current.isReady).toBe(false);
    expect(result.current.disabledServerIds).toEqual([]);
    act(() => result.current.toggleServer("linear"));
    expect(result.current.disabledServerIds).toEqual([]);
    expect(mockUpdateChat).not.toHaveBeenCalled();

    mockUseChatDetail.mockReturnValue({ data: chatDetail(["github"]) });
    rerender({ id: "chat-1" });
    expect(result.current.isReady).toBe(true);

    act(() => result.current.toggleServer("linear"));
    await waitFor(() =>
      expect(mockUpdateChat).toHaveBeenCalledWith({
        pathParams: { chatId: "chat-1" },
        body: { disabled_mcp_server_ids: ["github", "linear"] },
      }),
    );
  });

  it("is ready for a new chat right away and stays ready on the optimistic list", async () => {
    const { result } = renderDisabledServers(null);
    expect(result.current.isReady).toBe(true);

    mockUseChatDetail.mockReturnValue({ data: chatDetail([]) });
    const existing = renderDisabledServers("chat-1");
    act(() => existing.result.current.toggleServer("linear"));
    expect(existing.result.current.isReady).toBe(true);
    await waitFor(() => expect(mockUpdateChat).toHaveBeenCalledTimes(1));
  });

  it("does not fetch the row while the switches are not offered", () => {
    renderHook(
      () => useChatDisabledMcpServers({ chatId: "chat-1", isAvailable: false }),
      { wrapper },
    );

    expect(mockUseChatDetail).toHaveBeenCalledWith(
      expect.any(Symbol),
      expect.anything(),
    );
  });

  it("keeps showing the seeded list while the new chat's row is still loading", () => {
    const { result, rerender } = renderDisabledServers(null);

    act(() => result.current.toggleServer("linear"));
    expect(result.current.disabledServerIds).toEqual(["linear"]);

    // The chat got its id from the first send; the detail is not in yet, so
    // the seeded list is shown but nothing can be written from it.
    rerender({ id: "chat-1" });
    expect(result.current.disabledServerIds).toEqual(["linear"]);
    expect(result.current.newChatSeed).toBeUndefined();
    expect(result.current.isReady).toBe(false);

    mockUseChatDetail.mockReturnValue({ data: chatDetail(["linear"]) });
    rerender({ id: "chat-1" });
    expect(result.current.disabledServerIds).toEqual(["linear"]);
  });

  it("starts a fresh new chat with every server on again after leaving one with a switched-off server", () => {
    const { result, rerender } = renderDisabledServers(null);

    act(() => result.current.toggleServer("linear"));
    expect(result.current.disabledServerIds).toEqual(["linear"]);

    mockUseChatDetail.mockReturnValue({ data: chatDetail(["linear"]) });
    rerender({ id: "chat-1" });
    expect(result.current.disabledServerIds).toEqual(["linear"]);

    mockUseChatDetail.mockReturnValue({ data: undefined });
    rerender({ id: null });
    expect(result.current.disabledServerIds).toEqual([]);
    expect(result.current.newChatSeed).toBeUndefined();
  });

  it("starts from the default when switching between two existing chats", () => {
    const { result, rerender } = renderDisabledServers(null);

    act(() => result.current.toggleServer("linear"));
    rerender({ id: "chat-1" });
    expect(result.current.disabledServerIds).toEqual(["linear"]);

    rerender({ id: "chat-2" });
    expect(result.current.disabledServerIds).toEqual([]);
  });
});
