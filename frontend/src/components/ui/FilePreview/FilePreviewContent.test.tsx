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
});
