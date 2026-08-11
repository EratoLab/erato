import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createGraphTeamsChatFetcher } from "../../utils/teamsChatFetcher";
import { useTeamsChatFetcher } from "../useTeamsChatFetcher";

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
  createGraphTeamsChatFetcher: vi.fn(() => ({ kind: "graph" })),
}));

function prime(mode: AuthMode, graph: GraphTokenContextValue | null) {
  mockUseSessionAuth.mockReturnValue({ mode });
  mockUseGraphTokenOptional.mockReturnValue(graph);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useTeamsChatFetcher", () => {
  it("binds Chat.Read and nothing else", async () => {
    const acquireToken = vi.fn(() => Promise.resolve("token"));
    prime("entra-msal", { acquireToken });

    const { result } = renderHook(() => useTeamsChatFetcher());

    expect(result.current.unavailableReason).toBeNull();
    expect(result.current.fetcher).toEqual({ kind: "graph" });

    const bound = vi.mocked(createGraphTeamsChatFetcher).mock.calls[0][0];
    await bound({ forceRefresh: true });
    expect(acquireToken).toHaveBeenCalledWith(["Chat.Read"], {
      forceRefresh: true,
    });
  });

  it("reports graph-unavailable when no Graph provider is mounted", () => {
    prime("entra-msal", null);

    const { result } = renderHook(() => useTeamsChatFetcher());

    expect(result.current.fetcher).toBeNull();
    expect(result.current.unavailableReason).toBe("graph-unavailable");
    expect(createGraphTeamsChatFetcher).not.toHaveBeenCalled();
  });

  it("reports unsupported-mode outside an Entra session, even with a token context", () => {
    prime("unsupported", { acquireToken: vi.fn() });

    const { result } = renderHook(() => useTeamsChatFetcher());

    expect(result.current.fetcher).toBeNull();
    expect(result.current.unavailableReason).toBe("unsupported-mode");
  });

  it("never throws — the caller hides the entry rather than apologising", () => {
    prime("unsupported", null);
    expect(() => renderHook(() => useTeamsChatFetcher())).not.toThrow();
  });
});
