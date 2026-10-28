import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CloudSearchResults } from "./CloudSearchResults";

import type { CloudSearchResultsProps } from "./CloudSearchResults";

vi.mock("@/components/providers/ThemeProvider", () => ({
  useTheme: () => ({ iconMappings: {} }),
}));

function renderFile(parentPath?: string, size = 102400) {
  const props: CloudSearchResultsProps = {
    drives: [],
    files: [
      {
        id: "budget",
        name: "Budget.pdf",
        drive_id: "finance",
        drive_name: "Finance",
        provider: "sharepoint",
        is_folder: false,
        parent_path: parentPath,
        size,
      },
    ],
    isLoading: false,
    error: false,
    truncated: false,
    multiple: true,
    onRetry: vi.fn(),
    onSelectDrive: vi.fn(),
    onToggleFile: vi.fn(),
    isSelected: () => false,
    getDisabledReason: () => null,
  };
  render(<CloudSearchResults {...props} />);
}

describe("cloud search file details", () => {
  it.each([undefined, "", "/"])(
    "shows only the drive for a root file with path %s",
    (path) => {
      renderFile(path);
      expect(screen.getByTitle("Finance")).toHaveTextContent("Finance");
      expect(
        screen.queryByText(/Folder path unavailable/),
      ).not.toBeInTheDocument();
    },
  );

  it("retains nested folder paths", () => {
    renderFile("/Annual reports/2026");
    expect(
      screen.getByTitle("Finance / Annual reports/2026"),
    ).toBeInTheDocument();
  });

  it.each<[number, string]>([
    [512, "512 B"],
    [102400, "100.0 KB"],
    [2621440, "2.5 MB"],
    [1073741824, "1.0 GB"],
  ])("formats %s bytes like the folder browser", (size, label) => {
    renderFile("/Reports", size);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
