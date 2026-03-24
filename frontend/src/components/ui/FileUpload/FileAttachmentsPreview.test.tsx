import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FileAttachmentsPreview } from "./FileAttachmentsPreview";

vi.mock("./FilePreviewButton", () => ({
  FilePreviewButton: ({ file }: { file: { filename: string } }) => (
    <div>{file.filename}</div>
  ),
}));

vi.mock("../Container/InteractiveContainer", () => ({
  InteractiveContainer: ({
    children,
    className,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
}));

vi.mock("../Controls/Button", () => ({
  Button: ({
    children,
    className,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button className={className} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("../Controls/Tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("FileAttachmentsPreview", () => {
  it("keeps the shared attachment preview on its default geometry", () => {
    const attachedFiles = [
      { id: "file-1", filename: "spec.pdf" },
      { id: "file-2", filename: "notes.txt" },
    ];

    const { container } = render(
      <FileAttachmentsPreview
        attachedFiles={attachedFiles as never}
        maxFiles={5}
        onRemoveFile={vi.fn()}
        onRemoveAllFiles={vi.fn()}
      />,
    );

    const frame = container.firstElementChild as HTMLElement;
    const heading = screen.getByText(/Attachments/)
      .parentElement as HTMLElement;
    const list = heading.nextElementSibling as HTMLElement;

    expect(frame.className).toContain("mb-3");
    expect(frame.className).not.toContain("border-theme-border");
    expect(frame.getAttribute("style")).toBeNull();
    expect(heading.className).toContain("mb-2");
    expect(list.className).toContain("gap-2");
  });

  it("supports opt-in message geometry for staged chat attachments", () => {
    const attachedFiles = [
      { id: "file-1", filename: "spec.pdf" },
      { id: "file-2", filename: "notes.txt" },
    ];

    const { container } = render(
      <FileAttachmentsPreview
        attachedFiles={attachedFiles as never}
        maxFiles={5}
        onRemoveFile={vi.fn()}
        onRemoveAllFiles={vi.fn()}
        surfaceVariant="message"
      />,
    );

    const frame = container.firstElementChild;
    const heading = screen.getByText(/Attachments/).parentElement;
    const list = heading?.nextElementSibling;

    expect(frame).toHaveStyle({
      borderRadius: "var(--theme-radius-message)",
      padding:
        "var(--theme-spacing-message-padding-y) var(--theme-spacing-message-padding-x)",
    });
    expect(heading).toHaveStyle({
      gap: "var(--theme-spacing-control-gap)",
      marginBottom: "var(--theme-spacing-control-gap)",
    });
    expect(list).toHaveStyle({
      gap: "var(--theme-spacing-control-gap)",
    });
  });
});
