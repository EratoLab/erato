import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { messages as enMessages } from "@/locales/en/messages.json";

import { FileAttachmentsPreview } from "./FileAttachmentsPreview";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

async function renderWithProviders(ui: React.ReactElement) {
  const { i18n } = await import("@lingui/core");
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");

  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider
        enableCustomTheme={false}
        initialThemeMode="light"
        persistThemeMode={false}
      >
        {ui}
      </ThemeProvider>
    </I18nProvider>,
  );
}

const file = (
  id: string,
  filename: string,
  previewUrl?: string,
): FileUploadItem =>
  ({
    id,
    filename,
    download_url: `https://example.invalid/${id}`,
    preview_url: previewUrl,
  }) as FileUploadItem;

describe("FileAttachmentsPreview", () => {
  it("renders one tile per attached file", async () => {
    await renderWithProviders(
      <FileAttachmentsPreview
        attachedFiles={[file("1", "spec.pdf"), file("2", "notes.txt")]}
        maxFiles={5}
        onRemoveFile={vi.fn()}
        onRemoveAllFiles={vi.fn()}
      />,
    );

    expect(screen.getByText("spec.pdf")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
  });

  it("labels each tile with its extension rather than its type family", async () => {
    // .csv and .xlsx are both "Spreadsheet"; the extension is what tells them
    // apart at tile size.
    await renderWithProviders(
      <FileAttachmentsPreview
        attachedFiles={[file("1", "revenue.csv"), file("2", "revenue.xlsx")]}
        maxFiles={5}
        onRemoveFile={vi.fn()}
        onRemoveAllFiles={vi.fn()}
      />,
    );

    expect(screen.getByText("CSV")).toBeInTheDocument();
    expect(screen.getByText("XLSX")).toBeInTheDocument();
  });

  it("renders a thumbnail for an image that has a preview URL", async () => {
    await renderWithProviders(
      <FileAttachmentsPreview
        attachedFiles={[
          file("1", "shot.png", "https://example.invalid/preview/1"),
        ]}
        maxFiles={5}
        onRemoveFile={vi.fn()}
        onRemoveAllFiles={vi.fn()}
      />,
    );

    expect(screen.getByRole("img", { name: "shot.png" })).toHaveAttribute(
      "src",
      "https://example.invalid/preview/1",
    );
  });

  it("does not point an <img> at a non-image that has a preview URL", async () => {
    // Every upload carries a preview_url, including PDFs — it proxies raw
    // bytes rather than a rendered thumbnail.
    await renderWithProviders(
      <FileAttachmentsPreview
        attachedFiles={[
          file("1", "report.pdf", "https://example.invalid/preview/1"),
        ]}
        maxFiles={5}
        onRemoveFile={vi.fn()}
        onRemoveAllFiles={vi.fn()}
      />,
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("removes the file the remove button belongs to", async () => {
    const onRemoveFile = vi.fn();
    await renderWithProviders(
      <FileAttachmentsPreview
        attachedFiles={[file("1", "spec.pdf"), file("2", "notes.txt")]}
        maxFiles={5}
        onRemoveFile={onRemoveFile}
        onRemoveAllFiles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Remove notes\.txt/ }));

    expect(onRemoveFile).toHaveBeenCalledExactlyOnceWith("2");
  });

  it("keeps the bulk remove out of the way while the list is short", async () => {
    await renderWithProviders(
      <FileAttachmentsPreview
        attachedFiles={[file("1", "spec.pdf"), file("2", "notes.txt")]}
        maxFiles={5}
        onRemoveFile={vi.fn()}
        onRemoveAllFiles={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Remove all/ }),
    ).not.toBeInTheDocument();
  });

  it("offers a bulk remove once the list is long enough to need one", async () => {
    const onRemoveAllFiles = vi.fn();
    await renderWithProviders(
      <FileAttachmentsPreview
        attachedFiles={[
          file("1", "spec.pdf"),
          file("2", "notes.txt"),
          file("3", "data.csv"),
        ]}
        maxFiles={5}
        onRemoveFile={vi.fn()}
        onRemoveAllFiles={onRemoveAllFiles}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Remove all/ }));

    expect(onRemoveAllFiles).toHaveBeenCalledOnce();
  });

  it("shows the staged count against the host's limit", async () => {
    // The staged area caps and scrolls, so the count is what tells the user
    // there is more attached than is visible.
    await renderWithProviders(
      <FileAttachmentsPreview
        attachedFiles={[file("1", "spec.pdf"), file("2", "notes.txt")]}
        maxFiles={50}
        onRemoveFile={vi.fn()}
        onRemoveAllFiles={vi.fn()}
      />,
    );

    expect(screen.getByText("2/50")).toBeInTheDocument();
  });

  it("renders nothing when there is nothing attached", async () => {
    const { container } = await renderWithProviders(
      <FileAttachmentsPreview
        attachedFiles={[]}
        maxFiles={5}
        onRemoveFile={vi.fn()}
        onRemoveAllFiles={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
