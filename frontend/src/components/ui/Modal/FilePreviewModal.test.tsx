import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { FileTypeUtil } from "@/utils/fileTypes";

import { FilePreviewModal } from "./FilePreviewModal";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

const makeFile = (overrides: Partial<FileUploadItem> = {}): FileUploadItem => ({
  id: "file_123",
  filename: "shared-report.pdf",
  download_url: "https://files.example.com/shared-report.pdf",
  preview_url: "https://files.example.com/preview/shared-report.pdf" as never,
  file_contents_unavailable_missing_permissions: false,
  file_capability: FileTypeUtil.createMockFileCapability("shared-report.pdf"),
  ...overrides,
});

const renderWithTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider>{ui}</ThemeProvider>);

describe("FilePreviewModal", () => {
  it("shows a permission warning instead of preview actions for inaccessible files", () => {
    renderWithTheme(
      <FilePreviewModal
        isOpen={true}
        onClose={vi.fn()}
        file={makeFile({
          download_url: "",
          preview_url: undefined,
          file_contents_unavailable_missing_permissions: true,
        })}
      />,
    );

    expect(
      screen.getByText(
        "This file is unavailable because you do not have permission to access it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Download File" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-preview-pdf")).not.toBeInTheDocument();
  });
});
