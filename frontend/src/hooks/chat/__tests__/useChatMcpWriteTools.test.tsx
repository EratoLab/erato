import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChatMcpWriteTools } from "../useChatMcpWriteTools";

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

const chatDetail = (mcpWriteToolsEnabled: boolean): ChatDetail => ({
  id: "chat-1",
  title_resolved: "Chat",
  is_pinned: false,
  mcp_write_tools_enabled: mcpWriteToolsEnabled,
  disabled_mcp_server_ids: [],
  can_edit: true,
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

const renderWriteTools = (chatId: string | null) =>
  renderHook(
    ({ id }: { id: string | null }) =>
      useChatMcpWriteTools({ chatId: id, isAvailable: true }),
    { wrapper, initialProps: { id: chatId } },
  );

describe("useChatMcpWriteTools", () => {
  beforeEach(() => {
    mockUseChatDetail.mockReset();
    mockUpdateChat.mockReset();
    mockUseChatDetail.mockReturnValue({ data: undefined });
    mockUpdateChat.mockResolvedValue({});
  });

  it("keeps a new chat's switch locally and hands it to the first send only when off", () => {
    const { result } = renderWriteTools(null);

    expect(result.current.enabled).toBe(true);
    expect(result.current.newChatSeed).toBeUndefined();

    act(() => result.current.toggle());

    expect(result.current.enabled).toBe(false);
    expect(result.current.newChatSeed).toBe(false);
    expect(mockUpdateChat).not.toHaveBeenCalled();

    act(() => result.current.toggle());
    expect(result.current.newChatSeed).toBeUndefined();
  });

  it("reads an existing chat's switch from its row and writes a flip back through the update endpoint", async () => {
    mockUseChatDetail.mockReturnValue({ data: chatDetail(false) });
    const { result } = renderWriteTools("chat-1");

    expect(result.current.enabled).toBe(false);
    expect(result.current.newChatSeed).toBeUndefined();

    act(() => result.current.toggle());

    // Optimistic: the row reads on before the server answers.
    expect(result.current.enabled).toBe(true);
    await waitFor(() =>
      expect(mockUpdateChat).toHaveBeenCalledWith({
        pathParams: { chatId: "chat-1" },
        body: { mcp_write_tools_enabled: true },
      }),
    );
  });

  it("falls back to the row's value when the update fails", async () => {
    mockUseChatDetail.mockReturnValue({ data: chatDetail(true) });
    mockUpdateChat.mockRejectedValue(new Error("boom"));
    const { result } = renderWriteTools("chat-1");

    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(false);

    await waitFor(() => expect(result.current.enabled).toBe(true));
  });

  it("does not fetch the row while the switch is not offered", () => {
    renderHook(
      () => useChatMcpWriteTools({ chatId: "chat-1", isAvailable: false }),
      { wrapper },
    );

    expect(mockUseChatDetail).toHaveBeenCalledWith(
      expect.any(Symbol),
      expect.anything(),
    );
  });

  it("keeps showing the seeded value while the new chat's row is still loading", () => {
    const { result, rerender } = renderWriteTools(null);

    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(false);

    // The chat got its id from the first send; the detail is not in yet.
    rerender({ id: "chat-1" });
    expect(result.current.enabled).toBe(false);
    expect(result.current.newChatSeed).toBeUndefined();

    mockUseChatDetail.mockReturnValue({ data: chatDetail(false) });
    rerender({ id: "chat-1" });
    expect(result.current.enabled).toBe(false);
  });

  it("starts a fresh new chat with writes on again after leaving one that was off", () => {
    const { result, rerender } = renderWriteTools(null);

    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(false);

    mockUseChatDetail.mockReturnValue({ data: chatDetail(false) });
    rerender({ id: "chat-1" });
    expect(result.current.enabled).toBe(false);

    mockUseChatDetail.mockReturnValue({ data: undefined });
    rerender({ id: null });
    expect(result.current.enabled).toBe(true);
    expect(result.current.newChatSeed).toBeUndefined();
  });

  it("starts from the default when switching between two existing chats", () => {
    const { result, rerender } = renderWriteTools(null);

    act(() => result.current.toggle());
    rerender({ id: "chat-1" });
    expect(result.current.enabled).toBe(false);

    rerender({ id: "chat-2" });
    expect(result.current.enabled).toBe(true);
  });
});
