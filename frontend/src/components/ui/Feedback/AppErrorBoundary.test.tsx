import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recoverFromChunkLoadFailure } from "@/lib/chunkLoadRecovery";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { AppErrorBoundary } from "./AppErrorBoundary";

vi.mock("@/lib/chunkLoadRecovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chunkLoadRecovery")>()),
  recoverFromChunkLoadFailure: vi.fn().mockResolvedValue("no-update"),
}));
const recover = vi.mocked(recoverFromChunkLoadFailure);

function Thrower({ error }: { error: Error }): never {
  throw error;
}

const reload = vi.fn();

describe("AppErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("location", { ...window.location, reload });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(console.error).mockRestore();
    reload.mockReset();
    recover.mockClear();
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
    expect(recover).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("checks for a newer build when a code file failed to load, and still shows the way out", () => {
    render(
      <AppErrorBoundary>
        <Thrower
          error={
            new TypeError(
              "Failed to fetch dynamically imported module: /assets/Page-old.js",
            )
          }
        />
      </AppErrorBoundary>,
    );

    expect(recover).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});
