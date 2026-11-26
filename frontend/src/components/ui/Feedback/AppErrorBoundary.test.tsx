import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isChunkReloadPending,
  resetChunkLoadRecoveryForTests,
} from "@/lib/chunkLoadRecovery";
import { connectivity } from "@/lib/connectivity/connectivity";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { AppErrorBoundary } from "./AppErrorBoundary";

function Thrower({ error }: { error: Error }): never {
  throw error;
}

const reload = vi.fn();

describe("AppErrorBoundary", () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetChunkLoadRecoveryForTests();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("location", { ...window.location, reload });
    vi.spyOn(connectivity, "reportNetworkFailure").mockImplementation(() => {});
    vi.spyOn(connectivity, "waitUntilOnline").mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    reload.mockReset();
  });

  it("shows a plain message with a reload button instead of a blank page", () => {
    render(
      <StaticFeatureConfigProvider>
        <AppErrorBoundary>
          <Thrower error={new Error("Cannot read properties of undefined")} />
        </AppErrorBoundary>
      </StaticFeatureConfigProvider>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(
      screen.queryByText("Cannot read properties of undefined"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads once for a code file that failed to load and shows the start screen meanwhile", async () => {
    render(
      <AppErrorBoundary reloadingFallback={<p>Starting</p>}>
        <Thrower
          error={
            new TypeError(
              "Failed to fetch dynamically imported module: /assets/Page-old.js",
            )
          }
        />
      </AppErrorBoundary>,
    );

    expect(isChunkReloadPending()).toBe(true);
    expect(screen.getByText("Starting")).toBeInTheDocument();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });
});
