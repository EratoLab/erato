import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { claimLeftEdge } from "./hostLeftEdge";

import type { HostShell } from "./hostShell";

const shellWithRequests = () => {
  const request = vi.fn(() => Promise.resolve(null));
  const shell: HostShell = {
    capabilities: { leftEdgeSwipe: 1 },
    request,
    on: () => () => {},
  };
  return { shell, request };
};

describe("claimLeftEdge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("claims once and gives the edge back when the last holder lets go", () => {
    const { shell, request } = shellWithRequests();

    const first = claimLeftEdge(shell);
    const second = claimLeftEdge(shell);
    first();
    vi.runAllTimers();
    expect(request.mock.calls).toEqual([
      ["leftEdgeSwipe.claim", { claimed: true }],
    ]);

    second();
    vi.runAllTimers();
    expect(request).toHaveBeenLastCalledWith("leftEdgeSwipe.claim", {
      claimed: false,
    });
  });

  it("keeps the edge when a holder lets go and another takes it at once", () => {
    const { shell, request } = shellWithRequests();
    const leaving = claimLeftEdge(shell);
    request.mockClear();

    leaving();
    const arriving = claimLeftEdge(shell);
    vi.runAllTimers();

    expect(request).not.toHaveBeenCalled();
    arriving();
  });

  it("claims again when the page returns from the back-forward cache", () => {
    const { shell, request } = shellWithRequests();
    const release = claimLeftEdge(shell);
    request.mockClear();

    const pageshow = new Event("pageshow");
    Object.defineProperty(pageshow, "persisted", { value: true });
    window.dispatchEvent(pageshow);

    expect(request).toHaveBeenCalledWith("leftEdgeSwipe.claim", {
      claimed: true,
    });
    release();
  });
});
