import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { useFileUploadStore } from "@/hooks/files/useFileUploadStore";
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

  it("says a file is waiting for the network", () => {
    vi.spyOn(connectivity, "getStatus").mockReturnValue("offline");
    act(() => useFileUploadStore.getState().setWaitingForNetwork(true));

    render(
      <ThemeProvider enableCustomTheme={false}>
        <ConnectionWarning />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("connection-warning")).toHaveTextContent(
      "Waiting for the network. The upload continues once the connection is back.",
    );
    act(() => useFileUploadStore.getState().setWaitingForNetwork(false));
  });
});
