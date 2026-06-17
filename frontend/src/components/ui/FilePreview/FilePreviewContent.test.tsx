import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";

import { FilePreviewContent } from "./FilePreviewContent";

import type React from "react";

const useDocxModelMock = vi.hoisted(() =>
  vi.fn((file?: ArrayBuffer) => ({
    model: file ? { type: "mock-docx-model" } : undefined,
    isLoading: false,
    error: undefined,
  })),
);
const setWasmSourceMock = vi.hoisted(() => vi.fn());

vi.mock("@extend-ai/react-docx", () => ({
  ReactDocxViewer: ({ model }: { model?: unknown }) => (
    <div data-testid="mock-react-docx-viewer">
      {model ? "DOCX rendered" : "DOCX empty"}
    </div>
  ),
  setWasmSource: setWasmSourceMock,
  useDocxModel: useDocxModelMock,
}));

vi.mock("@extend-ai/react-xlsx", () => ({
  XlsxViewer: ({
    fileName,
    isDark,
    readOnly,
    src,
    useWorker,
  }: {
    fileName?: string;
    isDark?: boolean;
    readOnly?: boolean;
    src?: string;
    useWorker?: boolean;
  }) => (
    <div
      data-filename={fileName}
      data-is-dark={isDark ? "true" : "false"}
      data-read-only={readOnly ? "true" : "false"}
      data-src={src}
      data-testid="mock-react-xlsx-viewer"
      data-use-worker={useWorker ? "true" : "false"}
    >
      XLSX rendered
    </div>
  ),
}));

const renderWithTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider>{ui}</ThemeProvider>);

const mockFetchBuffer = () => {
  const buffer = new Uint8Array([1, 2, 3]).buffer;
  global.fetch = vi.fn(async () => {
    return {
      ok: true,
      arrayBuffer: async () => buffer,
    } as Response;
  });
};

describe("FilePreviewContent", () => {
  it("renders DOCX files through the DOCX viewer", async () => {
    mockFetchBuffer();

    renderWithTheme(
      <FilePreviewContent
        filename="notes.docx"
        url="https://files.example.com/download/notes.docx"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("mock-react-docx-viewer")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("mock-react-docx-viewer")).toHaveTextContent(
      "DOCX rendered",
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "https://files.example.com/download/notes.docx",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("uses the DOCX viewer when the MIME type identifies a document", async () => {
    mockFetchBuffer();

    renderWithTheme(
      <FilePreviewContent
        filename="download"
        url="https://files.example.com/download/notes"
        mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("mock-react-docx-viewer")).toBeInTheDocument(),
    );
  });

  it("lets the DOCX preview theme toggle independently", async () => {
    mockFetchBuffer();

    renderWithTheme(
      <FilePreviewContent
        filename="notes.docx"
        url="https://files.example.com/download/notes.docx"
      />,
    );

    const preview = await screen.findByTestId("file-preview-docx");
    expect(preview).toHaveAttribute("data-docx-theme", "light");

    fireEvent.click(
      screen.getByRole("button", { name: "Use dark document theme" }),
    );

    expect(preview).toHaveAttribute("data-docx-theme", "dark");
    expect(
      screen.getByRole("button", { name: "Use light document theme" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("renders XLSX files through the XLSX viewer", () => {
    renderWithTheme(
      <FilePreviewContent
        filename="budget.xlsx"
        url="https://files.example.com/download/budget.xlsx"
      />,
    );

    expect(screen.getByTestId("mock-react-xlsx-viewer")).toHaveAttribute(
      "data-src",
      "https://files.example.com/download/budget.xlsx",
    );
    expect(screen.getByTestId("mock-react-xlsx-viewer")).toHaveAttribute(
      "data-filename",
      "budget.xlsx",
    );
    expect(screen.getByTestId("mock-react-xlsx-viewer")).toHaveAttribute(
      "data-read-only",
      "true",
    );
    expect(screen.getByTestId("mock-react-xlsx-viewer")).toHaveAttribute(
      "data-use-worker",
      "false",
    );
  });

  it("uses the XLSX viewer when the MIME type identifies a spreadsheet", () => {
    renderWithTheme(
      <FilePreviewContent
        filename="download"
        url="https://files.example.com/download/budget"
        mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      />,
    );

    expect(screen.getByTestId("mock-react-xlsx-viewer")).toBeInTheDocument();
  });

  it("lets the XLSX preview theme toggle independently", () => {
    renderWithTheme(
      <FilePreviewContent
        filename="budget.xlsx"
        url="https://files.example.com/download/budget.xlsx"
      />,
    );

    const preview = screen.getByTestId("file-preview-xlsx");
    expect(preview).toHaveAttribute("data-xlsx-theme", "light");
    expect(screen.getByTestId("mock-react-xlsx-viewer")).toHaveAttribute(
      "data-is-dark",
      "false",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Use dark spreadsheet theme" }),
    );

    expect(preview).toHaveAttribute("data-xlsx-theme", "dark");
    expect(screen.getByTestId("mock-react-xlsx-viewer")).toHaveAttribute(
      "data-is-dark",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Use light spreadsheet theme" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
