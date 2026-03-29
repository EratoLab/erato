import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  THEME_MODE_LOCAL_STORAGE_KEY,
  ThemeProvider,
} from "@/components/providers/ThemeProvider";
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
  afterEach(() => {
    window.localStorage.clear();
  });

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
    expect(
      screen.getByRole("heading", { level: 1, name: "Title" }),
    ).not.toHaveAttribute("node");
    expect(container.querySelector("article")).toHaveClass("font-sans");
    expect(container.querySelector("p")).not.toHaveAttribute("node");
    expect(container.querySelector("strong")).toHaveClass("font-body-semibold");
    expect(container.querySelector("code")).toHaveClass("font-mono");
    expect(container.querySelector("code")).not.toHaveAttribute("node");
    expect(container.querySelector("code")).toHaveClass(
      "border-theme-code-inline-border",
    );
    expect(container.querySelector("code")).toHaveClass(
      "bg-theme-code-inline-bg",
    );
  });

  it("renders fenced code blocks with the built-in Prism light theme", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={textContent("```javascript\nconst answer = 42;\n```")}
      />,
    );

    const themedBlock = container.querySelector(
      "pre.message-content-code-block > div",
    );

    expect(
      container.querySelector("pre.message-content-code-block"),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(container.querySelector("pre pre")).toBeNull();
    expect(themedBlock).toHaveAttribute(
      "style",
      expect.stringContaining("background-color: white;"),
    );
    expect(themedBlock).toHaveAttribute(
      "style",
      expect.stringContaining("margin: 0px;"),
    );
    expect(
      container.querySelector("pre.message-content-code-block code"),
    ).toHaveTextContent("const answer = 42;");
  });

  it("uses the same Prism block renderer for untagged fenced code", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={textContent(
          "```\nline one of untagged code\nline two of untagged code\n```",
        )}
      />,
    );

    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(container.querySelector("pre pre")).toBeNull();
    expect(
      container.querySelector("pre.message-content-code-block > div"),
    ).toBeInTheDocument();
    expect(
      container.querySelector("pre.message-content-code-block code"),
    ).toHaveTextContent(
      /line one of untagged code\s+line two of untagged code/,
    );
    expect(
      container.querySelector("pre.message-content-code-block code"),
    ).not.toHaveAttribute("node");
  });

  it("treats single-line fenced code as block code instead of inline code", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={textContent("```\nsingle line of untagged code\n```")}
      />,
    );

    const blockCode = container.querySelector(
      "pre.message-content-code-block code",
    );

    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(container.querySelector("pre pre")).toBeNull();
    expect(
      container.querySelector("pre.message-content-code-block > div"),
    ).toBeInTheDocument();
    expect(blockCode).toHaveTextContent("single line of untagged code");
    expect(blockCode).not.toHaveClass("border-theme-code-inline-border");
    expect(blockCode).not.toHaveClass("bg-theme-code-inline-bg");
    expect(blockCode).not.toHaveAttribute("node");
  });

  it("switches fenced code blocks to Prism Dark+ in dark mode", () => {
    window.localStorage.setItem(THEME_MODE_LOCAL_STORAGE_KEY, "dark");

    const { container } = renderWithTheme(
      <MessageContent
        content={textContent("```javascript\nconst answer = 42;\n```")}
      />,
    );

    expect(
      container.querySelector("pre.message-content-code-block > div"),
    ).toHaveAttribute(
      "style",
      expect.stringContaining("background: rgb(30, 30, 30);"),
    );
    expect(
      container.querySelector("pre.message-content-code-block > div"),
    ).toHaveAttribute(
      "style",
      expect.stringContaining("color: rgb(212, 212, 212);"),
    );
  });

  it("uses the same code block contract for raw markdown view", () => {
    const { container } = renderWithTheme(
      <MessageContent content={textContent("`code`")} showRaw />,
    );

    expect(
      container.querySelector("pre.message-content-raw-block"),
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

  it("resolves preview-only erato-file links without requiring a download url", () => {
    const onFileLinkPreview = vi.fn();
    const file = makeFile({
      download_url: "",
    });

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
        download_url: "",
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

  it("renders erato-email code blocks as EratoEmailSuggestion instead of syntax highlighter", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={textContent(
          "```erato-email\nHere is a rewritten version of your email.\n```",
        )}
      />,
    );

    // Should NOT render as a syntax-highlighted code block
    expect(
      container.querySelector("pre.message-content-code-block code"),
    ).toBeNull();

    // Should render the suggestion text
    expect(screen.getByText(/Here is a rewritten version/)).toBeInTheDocument();

    // Should have a Copy button
    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
  });

  it("still renders other hyphenated language tags as code blocks", () => {
    const { container } = renderWithTheme(
      <MessageContent
        content={textContent(
          "```objective-c\n#import <Foundation/Foundation.h>\n```",
        )}
      />,
    );

    expect(
      container.querySelector("pre.message-content-code-block"),
    ).toBeInTheDocument();
    expect(
      container.querySelector("pre.message-content-code-block code"),
    ).toHaveTextContent(/#import/);
  });
});
