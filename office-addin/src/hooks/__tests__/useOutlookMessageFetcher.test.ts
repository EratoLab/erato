import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { detectExchangeOnPrem } from "../../utils/detectExchangeOnPrem";
import {
  createEwsOutlookMessageFetcher,
  createGraphOutlookMessageFetcher,
} from "../../utils/fetchOutlookMessage";
import { useOutlookMessageFetcher } from "../useOutlookMessageFetcher";

import type { AuthMode } from "../../auth/AuthSource";
import type { GraphTokenContextValue } from "../../providers/EntraGraphTokenProvider";

// The hook gates on auth, then dispatches by mailbox location; both auth hooks,
// the location probe, and both factories are stubbed so each case asserts
// exactly which factory was (not) consulted.
const mockUseSessionAuth = vi.fn();
const mockUseGraphTokenOptional = vi.fn();

vi.mock("../../providers/SessionAuthProvider", () => ({
  useSessionAuth: () => mockUseSessionAuth(),
}));

vi.mock("../../providers/EntraGraphTokenProvider", () => ({
  useGraphTokenOptional: () => mockUseGraphTokenOptional(),
}));

vi.mock("../../utils/detectExchangeOnPrem", () => ({
  detectExchangeOnPrem: vi.fn(() => false),
}));

vi.mock("../../utils/fetchOutlookMessage", () => ({
  createGraphOutlookMessageFetcher: vi.fn(() => ({ kind: "graph" })),
  createEwsOutlookMessageFetcher: vi.fn(() => ({ kind: "ews" })),
}));

function prime(
  mode: AuthMode,
  options: {
    graph?: GraphTokenContextValue | null;
    onPrem?: boolean;
  } = {},
) {
  mockUseSessionAuth.mockReturnValue({ mode });
  mockUseGraphTokenOptional.mockReturnValue(options.graph ?? null);
  vi.mocked(detectExchangeOnPrem).mockReturnValue(options.onPrem ?? false);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useOutlookMessageFetcher", () => {
  it("selects the Graph fetcher for a cloud mailbox when the Graph context is mounted", () => {
    prime("entra-msal", { graph: { acquireToken: vi.fn() }, onPrem: false });

    const { result } = renderHook(() => useOutlookMessageFetcher());

    expect(result.current.unavailableReason).toBeNull();
    expect(result.current.fetcher).toEqual({ kind: "graph" });
    expect(createGraphOutlookMessageFetcher).toHaveBeenCalledTimes(1);
    expect(createEwsOutlookMessageFetcher).not.toHaveBeenCalled();
  });

  it("binds the Graph acquirer to Mail.Read and passes forceRefresh through", async () => {
    const acquireToken = vi.fn().mockResolvedValue("graph-token");
    prime("entra-msal", { graph: { acquireToken }, onPrem: false });

    renderHook(() => useOutlookMessageFetcher());

    const boundAcquire = vi.mocked(createGraphOutlookMessageFetcher).mock
      .calls[0][0];
    await expect(boundAcquire()).resolves.toBe("graph-token");
    expect(acquireToken).toHaveBeenCalledWith(["Mail.Read"], undefined);

    await boundAcquire({ forceRefresh: true });
    expect(acquireToken).toHaveBeenCalledWith(["Mail.Read"], {
      forceRefresh: true,
    });
  });

  it("returns null + graph-unavailable for a cloud mailbox without the Graph context", () => {
    prime("entra-msal", { graph: null, onPrem: false });

    const { result } = renderHook(() => useOutlookMessageFetcher());

    expect(result.current.fetcher).toBeNull();
    expect(result.current.unavailableReason).toBe("graph-unavailable");
    expect(createGraphOutlookMessageFetcher).not.toHaveBeenCalled();
  });

  it("selects the EWS fetcher for an on-prem mailbox, ignoring the absent Graph context", () => {
    prime("entra-msal", { graph: null, onPrem: true });

    const { result } = renderHook(() => useOutlookMessageFetcher());

    expect(result.current.unavailableReason).toBeNull();
    expect(result.current.fetcher).toEqual({ kind: "ews" });
    expect(createEwsOutlookMessageFetcher).toHaveBeenCalledTimes(1);
    expect(createGraphOutlookMessageFetcher).not.toHaveBeenCalled();
  });

  it("returns null + unsupported-mode when not authenticated — never throws", () => {
    prime("unsupported", { graph: null, onPrem: true });

    const { result } = renderHook(() => useOutlookMessageFetcher());

    expect(result.current.fetcher).toBeNull();
    expect(result.current.unavailableReason).toBe("unsupported-mode");
    // The location probe must not pick a backend before auth gates.
    expect(createEwsOutlookMessageFetcher).not.toHaveBeenCalled();
    expect(createGraphOutlookMessageFetcher).not.toHaveBeenCalled();
  });

  it("memoizes the fetcher across rerenders while mode and Graph context are stable", () => {
    prime("entra-msal", { graph: null, onPrem: true });

    const { result, rerender } = renderHook(() => useOutlookMessageFetcher());
    const first = result.current.fetcher;

    rerender();

    expect(result.current.fetcher).toBe(first);
    expect(createEwsOutlookMessageFetcher).toHaveBeenCalledTimes(1);
  });
});
