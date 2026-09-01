import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";

import { FilePreviewContent } from "./FilePreviewContent";

import type React from "react";

// PDFium needs a worker and WebAssembly, neither of which jsdom provides.
vi.mock("./PdfPreview", () => ({
  PdfPreview: ({ url }: { url: string }) => (
    <div data-testid="file-preview-pdf" data-url={url} />
  ),
}));

vi.mock("./DocxPreview", async () => {
  const { useEffect, useState } = await import("react");
  return {
    DocxPreview: ({ url }: { url: string }) => {
      const [loaded, setLoaded] = useState(false);
      const [isDark, setIsDark] = useState(false);

      useEffect(() => {
        const controller = new AbortController();
        void fetch(url, { signal: controller.signal }).then(() =>
          setLoaded(true),
        );
        return () => controller.abort();
      }, [url]);

      return (
        <div
          data-docx-theme={isDark ? "dark" : "light"}
          data-testid="file-preview-docx"
        >
          <button
            type="button"
            aria-label={
              isDark ? "Use light document theme" : "Use dark document theme"
            }
            aria-pressed={isDark}
            onClick={() => setIsDark((current) => !current)}
          />
          {loaded && (
            <div data-testid="mock-react-docx-viewer">DOCX rendered</div>
          )}
        </div>
      );
    },
  };
});

vi.mock("./PptxPreview", () => ({
  PptxPreview: ({ url }: { url: string }) => (
    <div
      data-height="100%"
      data-mode="slide"
      data-show-thumbnails="true"
      data-show-toolbar="true"
      data-source={url}
      data-testid="mock-react-pptx-viewer"
    >
      PPTX rendered
    </div>
  ),
}));

vi.mock("./XlsxPreview", async () => {
  const { useState } = await import("react");
  return {
    XlsxPreview: ({ filename, url }: { filename: string; url: string }) => {
      const [isDark, setIsDark] = useState(false);
      return (
        <div
          data-testid="file-preview-xlsx"
          data-xlsx-theme={isDark ? "dark" : "light"}
        >
          <button
            type="button"
            aria-label={
              isDark
                ? "Use light spreadsheet theme"
                : "Use dark spreadsheet theme"
            }
            aria-pressed={isDark}
            onClick={() => setIsDark((current) => !current)}
          />
          <div
            data-filename={filename}
            data-is-dark={isDark ? "true" : "false"}
            data-read-only="true"
            data-src={url}
            data-testid="mock-react-xlsx-viewer"
            data-use-worker="false"
          >
            XLSX rendered
          </div>
        </div>
      );
    },
  };
});

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
  it("renders PDF files through the client-side PDF viewer", async () => {
    renderWithTheme(
      <FilePreviewContent
        filename="report.pdf"
        url="https://files.example.com/download/report.pdf"
      />,
    );

    // A native <iframe> is spec-blocked inside the sandboxed frame Teams hosts
    // tabs in, so this must stay a component rather than a browser viewer.
    const preview = await screen.findByTestId("file-preview-pdf");
    expect(preview.tagName).not.toBe("IFRAME");
    expect(preview).toHaveAttribute(
      "data-url",
      "https://files.example.com/download/report.pdf",
    );
  });

  it("uses the PDF viewer when the MIME type identifies a PDF", async () => {
    renderWithTheme(
      <FilePreviewContent
        filename="download"
        url="https://files.example.com/download/report"
        mimeType="application/pdf"
      />,
    );

    expect(await screen.findByTestId("file-preview-pdf")).toBeInTheDocument();
  });

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

  it("renders PPTX files through the presentation viewer", async () => {
    renderWithTheme(
      <FilePreviewContent
        filename="roadmap.pptx"
        url="https://files.example.com/download/roadmap.pptx"
      />,
    );

    const preview = await screen.findByTestId("mock-react-pptx-viewer");
    expect(preview).toHaveAttribute(
      "data-source",
      "https://files.example.com/download/roadmap.pptx",
    );
    expect(preview).toHaveAttribute("data-mode", "slide");
    expect(preview).toHaveAttribute("data-height", "100%");
    expect(preview).toHaveAttribute("data-show-toolbar", "true");
    expect(preview).toHaveAttribute("data-show-thumbnails", "true");
  });

  it("uses the presentation viewer for PPT MIME types and legacy PPT files", async () => {
    const { rerender } = renderWithTheme(
      <FilePreviewContent
        filename="download"
        url="https://files.example.com/download/roadmap"
        mimeType="application/vnd.openxmlformats-officedocument.presentationml.presentation"
      />,
    );

    expect(
      await screen.findByTestId("mock-react-pptx-viewer"),
    ).toBeInTheDocument();

    rerender(
      <ThemeProvider>
        <FilePreviewContent
          filename="legacy-slides.ppt"
          url="https://files.example.com/download/legacy-slides.ppt"
        />
      </ThemeProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("mock-react-pptx-viewer")).toHaveAttribute(
        "data-source",
        "https://files.example.com/download/legacy-slides.ppt",
      ),
    );
  });

  it("renders XLSX files through the XLSX viewer", async () => {
    renderWithTheme(
      <FilePreviewContent
        filename="budget.xlsx"
        url="https://files.example.com/download/budget.xlsx"
      />,
    );

    const preview = await screen.findByTestId("mock-react-xlsx-viewer");
    expect(preview).toHaveAttribute(
      "data-src",
      "https://files.example.com/download/budget.xlsx",
    );
    expect(preview).toHaveAttribute("data-filename", "budget.xlsx");
    expect(preview).toHaveAttribute("data-read-only", "true");
    expect(preview).toHaveAttribute("data-use-worker", "false");
  });

  it("uses the XLSX viewer when the MIME type identifies a spreadsheet", async () => {
    renderWithTheme(
      <FilePreviewContent
        filename="download"
        url="https://files.example.com/download/budget"
        mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      />,
    );

    expect(
      await screen.findByTestId("mock-react-xlsx-viewer"),
    ).toBeInTheDocument();
  });

  it("lets the XLSX preview theme toggle independently", async () => {
    renderWithTheme(
      <FilePreviewContent
        filename="budget.xlsx"
        url="https://files.example.com/download/budget.xlsx"
      />,
    );

    const preview = await screen.findByTestId("file-preview-xlsx");
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
