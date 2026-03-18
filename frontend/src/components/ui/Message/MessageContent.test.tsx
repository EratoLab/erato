import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { FileTypeUtil } from "@/utils/fileTypes";

import { MessageContent } from "./MessageContent";

import type {
  ContentPart,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

const renderWithTheme = (ui: React.ReactElement) => {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
};

const textContent = (text: string): ContentPart[] => [
  { content_type: "text", text },
];

const makeFile = (overrides: Partial<FileUploadItem> = {}): FileUploadItem => ({
  id: "file_123",
  filename: "sample-report-compressed.pdf",
  download_url: "https://files.example.com/sample-report-compressed.pdf",
  preview_url:
    "https://files.example.com/preview/sample-report-compressed.pdf" as never,
  file_capability: FileTypeUtil.createMockFileCapability(
    "sample-report-compressed.pdf",
  ),
  ...overrides,
});

describe("MessageContent", () => {
  it("adopts the theme typography hooks for headings and inline code", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={textContent(
          "# Title\n\n## Section\n\nText with **strong** and `code`.",
        )}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Title" }),
    ).toHaveClass("font-heading-bold");
    expect(
      screen.getByRole("heading", { level: 2, name: "Section" }),
    ).toHaveClass("font-heading");
    expect(container.querySelector("article")).toHaveClass("font-sans");
    expect(container.querySelector("strong")).toHaveClass("font-body-semibold");
    expect(container.querySelector("code")).toHaveClass("font-mono");
    expect(container.querySelector("code")).toHaveClass(
      "border-theme-code-inline-border",
    );
    expect(container.querySelector("code")).toHaveClass(
      "bg-theme-code-inline-bg",
    );
  });

  it("renders fenced code blocks with the foundation-backed code contract", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={textContent("```javascript\nconst answer = 42;\n```")}
      />,
    );

    expect(
      container.querySelector("pre.message-content-code-block"),
    ).toBeInTheDocument();
    expect(
      container.querySelector("pre.message-content-code-block .token.keyword"),
    ).toHaveTextContent("const");
  });

  it("uses the same code block contract for raw markdown view", () => {
    const { container } = renderWithTheme(
      <MessageContent content={textContent("`code`")} showRaw />,
    );

    expect(
      container.querySelector("pre.message-content-code-block"),
    ).toHaveClass("whitespace-pre-wrap");
  });

  it("passes PDF page anchors through to the preview callback for erato-file links", () => {
    const onFileLinkPreview = vi.fn();
    const file = makeFile();

    renderWithTheme(
      <MessageContent
        content={textContent("[Link](erato-file://file_123#page=4)")}
        filesById={{ [file.id]: file }}
        onFileLinkPreview={onFileLinkPreview}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "Link" }));

    expect(onFileLinkPreview).toHaveBeenCalledTimes(1);
    expect(onFileLinkPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "file_123",
        preview_url:
          "https://files.example.com/preview/sample-report-compressed.pdf#page=4",
      }),
    );
  });

  it("keeps external links opening in a new tab", () => {
    renderWithTheme(
      <MessageContent
        content={textContent("[External](https://example.com/docs)")}
      />,
    );

    const link = screen.getByRole("link", { name: "External" });
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
