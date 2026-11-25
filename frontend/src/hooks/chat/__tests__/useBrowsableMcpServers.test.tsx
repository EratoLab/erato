import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useBrowsableMcpServers } from "../useBrowsableMcpServers";

import type { McpServerStatus } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const mockUseListMcpServers = vi.fn();
const mockUseGetAssistant = vi.fn();
const mockUseChatDetail = vi.fn();

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useListMcpServers: (...args: unknown[]) => mockUseListMcpServers(...args),
  useGetAssistant: (...args: unknown[]) => mockUseGetAssistant(...args),
  useChatDetail: (...args: unknown[]) => mockUseChatDetail(...args),
}));

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useUserPreferencesFeature: () => ({ mcpServersTabEnabled: true }),
  useChatInputFeature: () => ({}),
}));

const server = (id: string, displayName: string): McpServerStatus => ({
  id,
  display_name: displayName,
  connection_status: "SUCCESS",
  authentication_mode: "oauth2",
});

const settled = (data: unknown) => ({
  data,
  isPending: false,
  isError: false,
});

describe("useBrowsableMcpServers", () => {
  beforeEach(() => {
    mockUseListMcpServers.mockReturnValue({
      data: {
        servers: [
          server("teams", "Microsoft Teams"),
          server("business_central", "Business Central"),
          server("dynamics", "Dynamics 365"),
        ],
      },
    });
    mockUseGetAssistant.mockReturnValue(settled(undefined));
    mockUseChatDetail.mockReturnValue(settled(undefined));
  });

  const names = (servers: McpServerStatus[]) =>
    servers.map((entry) => entry.display_name);

  it("lists every server, sorted by the name people see", () => {
    const { result } = renderHook(() => useBrowsableMcpServers());

    expect(result.current.isAvailable).toBe(true);
    expect(names(result.current.servers)).toEqual([
      "Business Central",
      "Dynamics 365",
      "Microsoft Teams",
    ]);
  });

  it("lists only the servers a new chat's assistant names", () => {
    mockUseGetAssistant.mockReturnValue(
      settled({ id: "assistant-1", mcp_server_ids: ["dynamics", "teams"] }),
    );

    const { result } = renderHook(() =>
      useBrowsableMcpServers({ assistantId: "assistant-1" }),
    );

    expect(names(result.current.servers)).toEqual([
      "Dynamics 365",
      "Microsoft Teams",
    ]);
  });

  // Hosts pass the assistant only until the chat exists; the chat itself
  // still belongs to it.
  it("scopes an existing chat by the assistant stored with it", () => {
    mockUseChatDetail.mockReturnValue(
      settled({ id: "chat-1", assistant_id: "assistant-1" }),
    );
    mockUseGetAssistant.mockReturnValue(
      settled({ id: "assistant-1", mcp_server_ids: ["dynamics"] }),
    );

    const { result } = renderHook(() =>
      useBrowsableMcpServers({ chatId: "chat-1" }),
    );

    expect(mockUseGetAssistant).toHaveBeenLastCalledWith(
      { pathParams: { assistantId: "assistant-1" } },
      expect.any(Object),
    );
    expect(names(result.current.servers)).toEqual(["Dynamics 365"]);
  });

  it("limits nothing for an assistant without a server list", () => {
    mockUseGetAssistant.mockReturnValue(settled({ id: "assistant-1" }));

    const { result } = renderHook(() =>
      useBrowsableMcpServers({ assistantId: "assistant-1" }),
    );

    expect(result.current.servers).toHaveLength(3);
  });

  it("stays hidden while the chat or its assistant is still loading", () => {
    mockUseChatDetail.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });
    const chat = renderHook(() => useBrowsableMcpServers({ chatId: "chat-1" }));
    expect(chat.result.current).toEqual({ isAvailable: false, servers: [] });

    mockUseChatDetail.mockReturnValue(settled(undefined));
    mockUseGetAssistant.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });
    const assistant = renderHook(() =>
      useBrowsableMcpServers({ assistantId: "assistant-1" }),
    );
    expect(assistant.result.current).toEqual({
      isAvailable: false,
      servers: [],
    });
  });

  // The backend keeps enforcing the assistant's list; the composer only
  // loses the narrowing.
  it("falls back to every server when the assistant cannot be loaded", () => {
    mockUseGetAssistant.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    });

    const { result } = renderHook(() =>
      useBrowsableMcpServers({ assistantId: "assistant-1" }),
    );

    expect(result.current.servers).toHaveLength(3);
  });
});
