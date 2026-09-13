import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { detectExchangeOnPrem } from "../../../utils/detectExchangeOnPrem";
import {
  createEwsOutlookMessageFetcher,
  createGraphOutlookMessageFetcher,
} from "../../utils/fetchOutlookMessage";
import { useOutlookMessageFetcher } from "../useOutlookMessageFetcher";

import type { AuthMode } from "../../../core/auth/AuthSource";
import type { GraphTokenContextValue } from "../../providers/EntraGraphTokenProvider";
import type { OutlookSharedContext } from "../../providers/OutlookMailItemProvider";

// The hook gates on auth, then dispatches by mailbox location and by whether
// the item came out of a shared store; both auth hooks, the item provider, the
// location probe, and both factories are stubbed so each case asserts exactly
// which factory was (not) consulted and how it was bound.
const mockUseSessionAuth = vi.fn();
const mockUseGraphTokenOptional = vi.fn();
const mockUseOutlookMailItem = vi.fn();

vi.mock("../../../core/SessionAuthProvider", () => ({
  useSessionAuth: () => mockUseSessionAuth(),
}));

vi.mock("../../providers/EntraGraphTokenProvider", () => ({
  useGraphTokenOptional: () => mockUseGraphTokenOptional(),
}));

vi.mock("../../providers/OutlookMailItemProvider", () => ({
  useOutlookMailItem: () => mockUseOutlookMailItem(),
}));

vi.mock("../../../utils/detectExchangeOnPrem", () => ({
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
    shared?: OutlookSharedContext | null;
    loadingShared?: boolean;
  } = {},
) {
  mockUseSessionAuth.mockReturnValue({ mode });
  mockUseGraphTokenOptional.mockReturnValue(options.graph ?? null);
  vi.mocked(detectExchangeOnPrem).mockReturnValue(options.onPrem ?? false);
  mockUseOutlookMailItem.mockReturnValue({
    mailItem: null,
    sharedContext: options.shared ?? null,
    isLoadingSharedContext: options.loadingShared ?? false,
  });
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

    // No owner binding: an item in the user's own mailbox must stay on `/me`
    // and must not widen the request to the shared scope.
    expect(createGraphOutlookMessageFetcher).toHaveBeenCalledWith(
      expect.any(Function),
      { owner: null },
    );

    const boundAcquire = vi.mocked(createGraphOutlookMessageFetcher).mock
      .calls[0][0];
    await expect(boundAcquire()).resolves.toBe("graph-token");
    expect(acquireToken).toHaveBeenCalledWith(["Mail.Read"], undefined);

    await boundAcquire({ forceRefresh: true });
    expect(acquireToken).toHaveBeenCalledWith(["Mail.Read"], {
      forceRefresh: true,
    });
  });

  it("retargets Graph at the owner and asks for Mail.Read.Shared for a shared item", async () => {
    const acquireToken = vi.fn().mockResolvedValue("graph-token");
    prime("entra-msal", {
      graph: { acquireToken },
      onPrem: false,
      shared: {
        owner: "shared@erato.test",
        targetMailbox: "shared@erato.test",
        delegatePermissions: 1,
      },
    });

    const { result } = renderHook(() => useOutlookMessageFetcher());

    expect(result.current.unavailableReason).toBeNull();
    expect(createGraphOutlookMessageFetcher).toHaveBeenCalledWith(
      expect.any(Function),
      { owner: "shared@erato.test" },
    );

    const boundAcquire = vi.mocked(createGraphOutlookMessageFetcher).mock
      .calls[0][0];
    await boundAcquire();
    expect(acquireToken).toHaveBeenCalledWith(["Mail.Read.Shared"], undefined);
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

  it("returns null + shared-mailbox-unsupported for a shared item on an on-prem mailbox", () => {
    prime("entra-msal", {
      graph: null,
      onPrem: true,
      shared: {
        owner: "shared@erato.test",
        targetMailbox: null,
        delegatePermissions: null,
      },
    });

    const { result } = renderHook(() => useOutlookMessageFetcher());

    expect(result.current.fetcher).toBeNull();
    expect(result.current.unavailableReason).toBe("shared-mailbox-unsupported");
    // The EWS backend would answer out of the delegate's own mailbox, so the
    // refusal has to win before the on-prem fetcher is built.
    expect(createEwsOutlookMessageFetcher).not.toHaveBeenCalled();
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

  it("withholds every backend while the mailbox location is still being probed", () => {
    prime("entra-msal", {
      graph: { acquireToken: vi.fn() },
      onPrem: false,
      loadingShared: true,
    });

    const { result } = renderHook(() => useOutlookMessageFetcher());

    expect(result.current.fetcher).toBeNull();
    expect(result.current.unavailableReason).toBe("mailbox-location-pending");
    // Building a `/me`-rooted fetcher here would be cached by the thread query
    // for the life of the selection, so the answer must be withheld rather
    // than guessed and corrected.
    expect(createGraphOutlookMessageFetcher).not.toHaveBeenCalled();
    expect(createEwsOutlookMessageFetcher).not.toHaveBeenCalled();
  });

  it("withholds the on-prem backend too while the probe is in flight", () => {
    prime("entra-msal", { graph: null, onPrem: true, loadingShared: true });

    const { result } = renderHook(() => useOutlookMessageFetcher());

    expect(result.current.unavailableReason).toBe("mailbox-location-pending");
    expect(createEwsOutlookMessageFetcher).not.toHaveBeenCalled();
  });

  it("roots Graph at targetMailbox when it differs from owner", async () => {
    const acquireToken = vi.fn().mockResolvedValue("graph-token");
    prime("entra-msal", {
      graph: { acquireToken },
      onPrem: false,
      shared: {
        owner: "alias@contoso.com",
        targetMailbox: "shared.team@contoso.onmicrosoft.com",
        delegatePermissions: 1,
      },
    });

    renderHook(() => useOutlookMessageFetcher());

    // Office documents targetMailbox as the mailbox location to address and
    // warns it can differ from owner between clients; rooting on owner would
    // 404 wherever they disagree.
    expect(createGraphOutlookMessageFetcher).toHaveBeenCalledWith(
      expect.any(Function),
      { owner: "shared.team@contoso.onmicrosoft.com" },
    );
  });

  it("falls back to owner when the host reports no targetMailbox", () => {
    prime("entra-msal", {
      graph: { acquireToken: vi.fn() },
      onPrem: false,
      shared: {
        owner: "shared@contoso.com",
        targetMailbox: null,
        delegatePermissions: null,
      },
    });

    renderHook(() => useOutlookMessageFetcher());

    expect(createGraphOutlookMessageFetcher).toHaveBeenCalledWith(
      expect.any(Function),
      { owner: "shared@contoso.com" },
    );
  });

  it("keeps the fetcher stable when the provider re-mints an identical shared context", () => {
    const graph = { acquireToken: vi.fn() };
    prime("entra-msal", {
      graph,
      onPrem: false,
      shared: {
        owner: "shared@contoso.com",
        targetMailbox: null,
        delegatePermissions: null,
      },
    });

    const { result, rerender } = renderHook(() => useOutlookMessageFetcher());
    const first = result.current.fetcher;

    // Hosts fire two selection events for a single selection, and the provider
    // mints a fresh context object for each. Keying on the address rather than
    // the object is what stops effects downstream from tearing down and
    // restarting on an unchanged mailbox.
    mockUseOutlookMailItem.mockReturnValue({
      mailItem: null,
      sharedContext: {
        owner: "shared@contoso.com",
        targetMailbox: null,
        delegatePermissions: null,
      },
      isLoadingSharedContext: false,
    });
    rerender();

    expect(result.current.fetcher).toBe(first);
    expect(createGraphOutlookMessageFetcher).toHaveBeenCalledTimes(1);
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
