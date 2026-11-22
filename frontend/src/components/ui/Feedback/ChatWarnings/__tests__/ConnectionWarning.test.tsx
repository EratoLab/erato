import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { connectivity } from "@/lib/connectivity/connectivity";

import { ConnectionWarning } from "../ConnectionWarning";

import type { ConnectivityStatus } from "@/lib/connectivity/connectivity";

describe("ConnectionWarning", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appears while the connection is lost and goes away once it is back", () => {
    let status: ConnectivityStatus = "online";
    const listeners = new Set<() => void>();
    vi.spyOn(connectivity, "getStatus").mockImplementation(() => status);
    vi.spyOn(connectivity, "subscribe").mockImplementation((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    const setStatus = (next: ConnectivityStatus) => {
      status = next;
      listeners.forEach((listener) => listener());
    };

    render(
      <ThemeProvider enableCustomTheme={false}>
        <ConnectionWarning />
      </ThemeProvider>,
    );
    expect(screen.queryByTestId("connection-warning")).toBeNull();

    act(() => setStatus("offline"));
    expect(screen.getByTestId("connection-warning")).toHaveTextContent(
      "Connection lost. Reconnecting…",
    );

    act(() => setStatus("online"));
    expect(screen.queryByTestId("connection-warning")).toBeNull();
  });
});
