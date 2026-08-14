import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { FileTypeUtil } from "@/utils/fileTypes";

import { FilePreviewModal } from "./FilePreviewModal";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

const useDocxModelMock = vi.hoisted(() =>
  vi.fn((file?: ArrayBuffer) => ({
    model: file ? { type: "mock-docx-model" } : undefined,
    isLoading: false,
    error: undefined,
  })),
);
const setWasmSourceMock = vi.hoisted(() => vi.fn());

// PDFium needs a worker and WebAssembly, neither of which jsdom provides.
vi.mock("@/components/ui/FilePreview/PdfPreview", () => ({
  PdfPreview: ({ url }: { url: string }) => (
    <div data-testid="file-preview-pdf" data-url={url} />
  ),
}));

vi.mock("@extend-ai/react-docx", () => ({
  ReactDocxViewer: ({ model }: { model?: unknown }) => (
    <div data-testid="mock-react-docx-viewer">
      {model ? "DOCX rendered" : "DOCX empty"}
    </div>
  ),
  setWasmSource: setWasmSourceMock,
  useDocxModel: useDocxModelMock,
}));

vi.mock("@extend-ai/react-pptx", () => ({
  ReactPptxViewer: ({ source }: { source?: string }) => (
    <div data-source={source} data-testid="mock-react-pptx-viewer">
      PPTX rendered
    </div>
  ),
  setWasmSource: setWasmSourceMock,
}));

vi.mock("@extend-ai/react-xlsx", () => ({
  XlsxViewer: ({ src }: { src?: string }) => (
    <div data-src={src} data-testid="mock-react-xlsx-viewer">
      XLSX rendered
    </div>
  ),
}));

const makeFile = (overrides: Partial<FileUploadItem> = {}): FileUploadItem => ({
  id: "file_123",
  filename: "shared-report.pdf",
  download_url: "https://files.example.com/shared-report.pdf",
  preview_url: "https://files.example.com/preview/shared-report.pdf",
  file_contents_unavailable_missing_permissions: false,
  is_sharepoint_file: false,
  file_capability: FileTypeUtil.createMockFileCapability("shared-report.pdf"),
  ...overrides,
});

const renderWithTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider>{ui}</ThemeProvider>);

describe("FilePreviewModal", () => {
  it("previews PDF files from the preview URL", async () => {
    renderWithTheme(
      <FilePreviewModal isOpen={true} onClose={vi.fn()} file={makeFile()} />,
    );

    expect(await screen.findByTestId("file-preview-pdf")).toHaveAttribute(
      "data-url",
      "https://files.example.com/preview/shared-report.pdf",
    );
  });

  it("states the caller's reason instead of blaming the file type", () => {
    renderWithTheme(
      <FilePreviewModal
        isOpen={true}
        onClose={vi.fn()}
        file={makeFile({ preview_url: null })}
        notPreviewableReason="This file is too large to preview here."
      />,
    );

    expect(
      screen.getByText("This file is too large to preview here."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Preview is not available for this file type."),
    ).not.toBeInTheDocument();
  });

  it("falls back to the file-type message with no reason given", () => {
    renderWithTheme(
      <FilePreviewModal
        isOpen={true}
        onClose={vi.fn()}
        file={makeFile({ preview_url: null })}
      />,
    );

    expect(
      screen.getByText("Preview is not available for this file type."),
    ).toBeInTheDocument();
  });

  it("previews DOCX files from the preview URL", async () => {
    global.fetch = vi.fn(async () => {
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as Response;
    });

    renderWithTheme(
      <FilePreviewModal
        isOpen={true}
        onClose={vi.fn()}
        file={makeFile({
          filename: "meeting-notes.docx",
          download_url: "https://files.example.com/download/meeting-notes.docx",
          preview_url: "https://files.example.com/preview/meeting-notes.docx",
          file_capability:
            FileTypeUtil.createMockFileCapability("meeting-notes.docx"),
        })}
      />,
    );

    await screen.findByTestId("mock-react-docx-viewer");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://files.example.com/preview/meeting-notes.docx",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("reaches the transcript renderer for a stored .md", () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("# not a transcript\n"),
      } as unknown as Response),
    );
    vi.stubGlobal("fetch", fetchMock);

    // Regression: this modal keeps its own allow-list, separate from
    // FilePreviewContent's routing. A type the renderer can draw but this gate
    // omits never reaches it — the user gets "not available" instead.
    renderWithTheme(
      <FilePreviewModal
        isOpen={true}
        onClose={vi.fn()}
        file={makeFile({
          filename: "teams-chats-2.md",
          download_url: "https://files.example.com/download/teams-chats-2.md",
          preview_url: "https://files.example.com/preview/teams-chats-2.md",
          file_capability:
            FileTypeUtil.createMockFileCapability("teams-chats-2.md"),
        })}
      />,
    );

    // The transcript renderer fetches the file; that request is the proof it
    // was reached. (The Download button renders in both branches, so its
    // presence says nothing either way.)
    expect(
      screen.queryByText(/Preview is not available for this file type/i),
    ).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://files.example.com/preview/teams-chats-2.md",
    );
  });

  it("previews XLSX files from the preview URL", () => {
    renderWithTheme(
      <FilePreviewModal
        isOpen={true}
        onClose={vi.fn()}
        file={makeFile({
          filename: "budget.xlsx",
          download_url: "https://files.example.com/download/budget.xlsx",
          preview_url: "https://files.example.com/preview/budget.xlsx",
          file_capability: FileTypeUtil.createMockFileCapability("budget.xlsx"),
        })}
      />,
    );

    expect(screen.getByTestId("mock-react-xlsx-viewer")).toHaveAttribute(
      "data-src",
      "https://files.example.com/preview/budget.xlsx",
    );
  });

  it("previews PPTX files from the preview URL", () => {
    renderWithTheme(
      <FilePreviewModal
        isOpen={true}
        onClose={vi.fn()}
        file={makeFile({
          filename: "roadmap.pptx",
          download_url: "https://files.example.com/download/roadmap.pptx",
          preview_url: "https://files.example.com/preview/roadmap.pptx",
          file_capability:
            FileTypeUtil.createMockFileCapability("roadmap.pptx"),
        })}
      />,
    );

    expect(screen.getByTestId("mock-react-pptx-viewer")).toHaveAttribute(
      "data-source",
      "https://files.example.com/preview/roadmap.pptx",
    );
  });

  it("previews presentation files when the MIME type identifies them", () => {
    renderWithTheme(
      <FilePreviewModal
        isOpen={true}
        onClose={vi.fn()}
        file={makeFile({
          filename: "download",
          preview_url: "https://files.example.com/preview/roadmap",
          file_capability: {
            ...FileTypeUtil.createMockFileCapability("roadmap.pptx"),
            mime_types: [
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ],
          },
        })}
      />,
    );

    expect(screen.getByTestId("mock-react-pptx-viewer")).toHaveAttribute(
      "data-source",
      "https://files.example.com/preview/roadmap",
    );
  });

  it("previews XLSX files when the MIME type identifies a spreadsheet", () => {
    renderWithTheme(
      <FilePreviewModal
        isOpen={true}
        onClose={vi.fn()}
        file={makeFile({
          filename: "download",
          preview_url: "https://files.example.com/preview/budget",
          file_capability: {
            ...FileTypeUtil.createMockFileCapability("budget.xlsx"),
            mime_types: [
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ],
          },
        })}
      />,
    );

    expect(screen.getByTestId("mock-react-xlsx-viewer")).toHaveAttribute(
      "data-src",
      "https://files.example.com/preview/budget",
    );
  });

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
