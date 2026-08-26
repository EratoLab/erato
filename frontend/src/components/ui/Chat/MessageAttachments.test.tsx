import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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
