import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { GroupedFileAttachmentsPreview } from "./GroupedFileAttachmentsPreview";
import { ThemeProvider } from "@/components/providers/ThemeProvider";

import type { Messages } from "@lingui/core";

async function renderWithI18n(ui: React.ReactElement) {
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

describe("GroupedFileAttachmentsPreview", () => {
  it("collapses long groups and expands them on demand", async () => {
    await renderWithI18n(
      <GroupedFileAttachmentsPreview
        groups={[
          {
            id: "group-email",
            label: "Current email",
            items: [
              {
                id: "body",
                file: {
                  id: "body",
                  filename: "message.html",
                  size: 1200,
                },
              },
              {
                id: "file-1",
                file: {
                  id: "file-1",
                  filename: "invoice.pdf",
                  size: 2048,
                },
              },
              {
                id: "file-2",
                file: {
                  id: "file-2",
                  filename: "notes.docx",
                  size: 4096,
                },
              },
            ],
          },
        ]}
        onRemoveFile={() => {}}
        defaultVisibleItems={2}
      />,
    );

    expect(screen.getByText("Current email")).toBeVisible();
    expect(screen.getByText("message")).toBeVisible();
    expect(screen.getByText(".html")).toBeVisible();
    expect(screen.getByText("invoice")).toBeVisible();
    expect(screen.getByText(".pdf")).toBeVisible();
    expect(screen.queryByText("notes")).toBeNull();
    expect(screen.getByRole("button", { name: /show 1 more item/i })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /show 1 more item/i }));

    expect(screen.getByText("notes")).toBeVisible();
    expect(screen.getByText(".docx")).toBeVisible();
  });

  it("renders loading items inline with the standardized loading row", async () => {
    await renderWithI18n(
      <GroupedFileAttachmentsPreview
        groups={[
          {
            id: "group-email",
            label: "Current email",
            items: [
              {
                id: "loading-1",
                file: {
                  id: "loading-1",
                  filename: "loading-placeholder",
                },
                isLoading: true,
              },
            ],
          },
        ]}
        onRemoveFile={() => {}}
      />,
    );

    expect(screen.getByText(/loading attachment/i)).toBeVisible();
    expect(screen.getByText(/please wait/i)).toBeVisible();
  });

  it("forwards file removal through item ids", async () => {
    const onRemoveFile = vi.fn();

    await renderWithI18n(
      <GroupedFileAttachmentsPreview
        groups={[
          {
            id: "group-email",
            label: "Current email",
            items: [
              {
                id: "file-1",
                file: {
                  id: "file-1",
                  filename: "invoice.pdf",
                  size: 2048,
                },
              },
            ],
          },
        ]}
        onRemoveFile={onRemoveFile}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /remove invoice\.pdf/i }));
    expect(onRemoveFile).toHaveBeenCalledWith("file-1");
  });
});
