import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { messages as enMessages } from "@/locales/en/messages.json";

import { MessageAttachments } from "./MessageAttachments";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

const fetchSpy = vi.spyOn(globalThis, "fetch");

async function renderWithProviders(ui: React.ReactElement) {
  const { i18n } = await import("@lingui/core");
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider i18n={i18n}>
        <ThemeProvider
          enableCustomTheme={false}
          initialThemeMode="light"
          persistThemeMode={false}
        >
          {ui}
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>,
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

const byId = (...files: FileUploadItem[]) =>
  Object.fromEntries(files.map((entry) => [entry.id, entry]));

describe("MessageAttachments", () => {
  it("resolves attachments from the conversation's own file map", async () => {
    const files = [file("1", "spec.pdf"), file("2", "notes.txt")];

    await renderWithProviders(
      <MessageAttachments
        fileIds={["1", "2"]}
        filesById={byId(...files)}
        relatedFiles={files}
      />,
    );

    expect(screen.getByText("spec.pdf")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
  });

  it("does not request files the conversation already knows about", async () => {
    fetchSpy.mockClear();
    const files = [file("1", "spec.pdf")];

    await renderWithProviders(
      <MessageAttachments
        fileIds={["1"]}
        filesById={byId(...files)}
        relatedFiles={files}
      />,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("offers no remove affordance, because a sent attachment cannot be removed", async () => {
    const files = [file("1", "spec.pdf")];

    await renderWithProviders(
      <MessageAttachments
        fileIds={["1"]}
        filesById={byId(...files)}
        relatedFiles={files}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /^Remove/ }),
    ).not.toBeInTheDocument();
  });

  it("names each attachment for assistive tech, since tiles carry no caption", async () => {
    const files = [
      file("1", "shot.png", "https://example.invalid/preview/1"),
      file("2", "revenue.csv"),
    ];

    await renderWithProviders(
      <MessageAttachments
        fileIds={["1", "2"]}
        filesById={byId(...files)}
        relatedFiles={files}
        onFilePreview={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Preview attachment shot.png, PNG" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Preview attachment revenue.csv, CSV",
      }),
    ).toBeInTheDocument();
  });

  it("hands the activated file and its siblings to the preview", async () => {
    const onFilePreview = vi.fn();
    const files = [file("1", "spec.pdf"), file("2", "notes.txt")];

    await renderWithProviders(
      <MessageAttachments
        fileIds={["1"]}
        filesById={byId(...files)}
        relatedFiles={files}
        onFilePreview={onFilePreview}
      />,
    );

    screen
      .getByRole("button", { name: /Preview attachment spec\.pdf/ })
      .click();

    expect(onFilePreview).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1" }),
      files,
    );
  });

  it("grows an image in place, between the tile and the full preview", async () => {
    const files = [file("1", "shot.png", "https://example.invalid/preview/1")];

    await renderWithProviders(
      <MessageAttachments
        fileIds={["1"]}
        filesById={byId(...files)}
        relatedFiles={files}
        onFilePreview={vi.fn()}
      />,
    );

    const toggle = screen.getByRole("button", { name: /Expand shot\.png/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(
      screen.getByRole("button", { name: /Collapse shot\.png/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("offers no in-place growth for a document, which has nothing larger to show", async () => {
    const files = [file("1", "report.pdf")];

    await renderWithProviders(
      <MessageAttachments
        fileIds={["1"]}
        filesById={byId(...files)}
        relatedFiles={files}
        onFilePreview={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Expand/ }),
    ).not.toBeInTheDocument();
  });

  it("gathers a Teams conversation and its shared files into one group", async () => {
    const files = [
      file("t1", "teams-Product_sync.md"),
      file("f1", "teams-file-abcd1234-Q3_report.pdf"),
      file("o1", "holiday.pdf"),
    ];

    await renderWithProviders(
      <MessageAttachments
        fileIds={["t1", "f1", "o1"]}
        filesById={byId(...files)}
        relatedFiles={files}
        onFilePreview={vi.fn()}
      />,
    );

    expect(screen.getByText("Teams conversation")).toBeInTheDocument();
    expect(screen.getByText("1 shared file")).toBeInTheDocument();
    // The shared file is named, not hashed; the unrelated one stays outside.
    expect(screen.getByText("Q3_report.pdf")).toBeInTheDocument();
    expect(screen.getByText("holiday.pdf")).toBeInTheDocument();
  });

  it("offers no removal on a grouped sent message", async () => {
    const files = [
      file("t1", "teams-Product_sync.md"),
      file("f1", "teams-file-abcd1234-Q3_report.pdf"),
    ];

    await renderWithProviders(
      <MessageAttachments
        fileIds={["t1", "f1"]}
        filesById={byId(...files)}
        relatedFiles={files}
        onFilePreview={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /^Remove/ }),
    ).not.toBeInTheDocument();
  });

  it("leaves an ordinary message ungrouped", async () => {
    const files = [file("1", "spec.pdf"), file("2", "notes.txt")];

    await renderWithProviders(
      <MessageAttachments
        fileIds={["1", "2"]}
        filesById={byId(...files)}
        relatedFiles={files}
      />,
    );

    expect(screen.queryByText("Teams conversation")).not.toBeInTheDocument();
  });

  it("skips ids it cannot resolve rather than rendering a broken tile", async () => {
    const files = [file("1", "spec.pdf")];

    await renderWithProviders(
      <MessageAttachments
        fileIds={["1", "not-in-the-map"]}
        filesById={byId(...files)}
        relatedFiles={files}
      />,
    );

    expect(screen.getByText("spec.pdf")).toBeInTheDocument();
    expect(screen.queryByText(/not-in-the-map/)).not.toBeInTheDocument();
  });

  it("renders nothing when no attachment resolves", async () => {
    const { container } = await renderWithProviders(
      <MessageAttachments
        fileIds={["missing"]}
        filesById={{}}
        relatedFiles={[]}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
