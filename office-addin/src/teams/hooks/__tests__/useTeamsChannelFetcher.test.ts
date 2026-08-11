import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createGraphTeamsChannelFetcher } from "../../utils/teamsChatFetcher";
import { useTeamsChannelFetcher } from "../useTeamsChannelFetcher";

import type { AuthMode } from "../../../core/auth/AuthSource";
import type { GraphTokenContextValue } from "../../../core/auth/GraphTokenProvider";

const mockUseSessionAuth = vi.fn();
const mockUseGraphTokenOptional = vi.fn();

vi.mock("../../../core/SessionAuthProvider", () => ({
  useSessionAuth: () => mockUseSessionAuth(),
}));

vi.mock("../../../core/auth/GraphTokenProvider", () => ({
  useGraphTokenOptional: () => mockUseGraphTokenOptional(),
}));

vi.mock("../../utils/teamsChatFetcher", () => ({
  createGraphTeamsChannelFetcher: vi.fn(() => ({ kind: "graph-channels" })),
}));

function prime(mode: AuthMode, graph: GraphTokenContextValue | null) {
  mockUseSessionAuth.mockReturnValue({ mode });
  mockUseGraphTokenOptional.mockReturnValue(graph);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useTeamsChannelFetcher", () => {
  it("binds the channel scopes apart from the chat ones", async () => {
    const acquireToken = vi.fn(() => Promise.resolve("token"));
    prime("entra-msal", { acquireToken });

    const { result } = renderHook(() => useTeamsChannelFetcher());

    expect(result.current.unavailableReason).toBeNull();
    expect(result.current.fetcher).toEqual({ kind: "graph-channels" });

    const bound = vi.mocked(createGraphTeamsChannelFetcher).mock.calls[0][0];
    await bound();
    expect(acquireToken).toHaveBeenCalledWith(
      [
        "Team.ReadBasic.All",
        "Channel.ReadBasic.All",
        "ChannelMessage.Read.All",
      ],
      expect.anything(),
    );
  });

  it("asks silently: a missing admin consent must not prompt for sign-in", async () => {
    const acquireToken = vi.fn(() => Promise.resolve("token"));
    prime("entra-msal", { acquireToken });

    renderHook(() => useTeamsChannelFetcher());
    const bound = vi.mocked(createGraphTeamsChannelFetcher).mock.calls[0][0];
    await bound({ forceRefresh: true });

    expect(acquireToken).toHaveBeenCalledWith(expect.anything(), {
      forceRefresh: true,
      suppressSignInPrompt: true,
    });
  });

  it("reports graph-unavailable when no Graph provider is mounted", () => {
    prime("entra-msal", null);

    const { result } = renderHook(() => useTeamsChannelFetcher());

    expect(result.current.fetcher).toBeNull();
    expect(result.current.unavailableReason).toBe("graph-unavailable");
    expect(createGraphTeamsChannelFetcher).not.toHaveBeenCalled();
  });

  it("reports unsupported-mode outside an Entra session", () => {
    prime("unsupported", { acquireToken: vi.fn() });

    const { result } = renderHook(() => useTeamsChannelFetcher());

    expect(result.current.fetcher).toBeNull();
    expect(result.current.unavailableReason).toBe("unsupported-mode");
  });
});
