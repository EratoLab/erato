import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDistribution } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import DesktopSidecarSetupPage from "../DesktopSidecarSetupPage";

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useDistribution: vi.fn(),
}));

function macTarget(architecture: string) {
  return {
    id: `macos-${architecture}`,
    platform: { os: "macos", architecture, abi: "darwin" },
    default_file: "application",
    files: [
      {
        id: "application",
        kind: "application_archive",
        size: 1024,
        download_filename: `erato-desktop-sidecar-macos-${architecture}.app.zip`,
      },
    ],
  };
}

function renderOnMac(clientHintArchitecture?: string) {
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: "MacIntel",
  });
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  });
  Object.defineProperty(window.navigator, "userAgentData", {
    configurable: true,
    value: clientHintArchitecture
      ? {
          getHighEntropyValues: () =>
            Promise.resolve({ architecture: clientHintArchitecture }),
        }
      : undefined,
  });
  return render(
    <I18nProvider i18n={i18n}>
      <MemoryRouter>
        <DesktopSidecarSetupPage />
      </MemoryRouter>
    </I18nProvider>,
  );
}

function processorOptions() {
  return within(
    screen.getByRole("heading", { name: "2. Processor" })
      .nextElementSibling as HTMLElement,
  ).getAllByRole("button");
}

describe("DesktopSidecarSetupPage on a Mac", () => {
  beforeEach(() => {
    vi.mocked(useDistribution).mockReturnValue({
      data: { targets: [macTarget("x86_64"), macTarget("aarch64")] },
      error: null,
      isLoading: false,
    } as unknown as ReturnType<typeof useDistribution>);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers Apple Silicon first and explains how to check when the chip is unknown", async () => {
    renderOnMac();

    await waitFor(() =>
      expect(
        screen.getByText(/Not sure which Mac you have\?/),
      ).toBeInTheDocument(),
    );
    expect(processorOptions().map((option) => option.textContent)).toEqual([
      expect.stringContaining("Apple Silicon (M1 or later)"),
      expect.stringContaining("Intel"),
    ]);
    expect(
      screen.queryByText("Recommended for this device"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("erato-desktop-sidecar-macos-aarch64.app.zip"),
    ).toBeInTheDocument();
  });

  it("recommends the build that client hints report", async () => {
    renderOnMac("x86");

    await waitFor(() =>
      expect(
        within(processorOptions()[1]).getByText("Recommended for this device"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText("erato-desktop-sidecar-macos-x86_64.app.zip"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Not sure which Mac you have\?/),
    ).not.toBeInTheDocument();
  });
});
