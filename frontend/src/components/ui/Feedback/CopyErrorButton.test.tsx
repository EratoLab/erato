import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CopyErrorButton } from "./CopyErrorButton";

const showCopyErrorReport = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useErrorReportFeature: () => ({
    showCopyErrorReport: showCopyErrorReport(),
    errorReportTemplate: "env={{environment}} platform={{platform}}\n{{error}}",
    environment: "test",
    platform: "common",
  }),
}));

describe("CopyErrorButton", () => {
  beforeEach(() => {
    showCopyErrorReport.mockReturnValue(true);
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("copies a rendered frontend error report with its backtrace", async () => {
    const error = new Error("Render failed");
    error.stack = "Error: Render failed\n    at ChatPanel (ChatPanel.tsx:42:5)";
    render(<CopyErrorButton error={error} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy error report" }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "env=test platform=common\nError: Render failed\n    at ChatPanel (ChatPanel.tsx:42:5)",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Copy error report" }),
    ).toHaveTextContent("Copied");
  });

  it("respects the copy-report feature flag", () => {
    showCopyErrorReport.mockReturnValue(false);

    render(<CopyErrorButton error={new Error("Render failed")} />);

    expect(
      screen.queryByRole("button", { name: "Copy error report" }),
    ).not.toBeInTheDocument();
  });
});
