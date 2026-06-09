import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { messages as enMessages } from "@/locales/en/messages.json";

import { GroupedFileAttachmentsPreview } from "./GroupedFileAttachmentsPreview";

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
                kind: "attachment",
                id: "body",
                file: {
                  id: "body",
                  filename: "message.html",
                  size: 1200,
                },
              },
              {
                kind: "attachment",
                id: "file-1",
                file: {
                  id: "file-1",
                  filename: "invoice.pdf",
                  size: 2048,
                },
              },
              {
                kind: "attachment",
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
    expect(
      screen.getByRole("button", { name: /show 1 more item/i }),
    ).toBeVisible();

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
                kind: "loading",
                id: "loading-1",
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

  it("supports custom loading labels for grouped async sources", async () => {
    await renderWithI18n(
      <GroupedFileAttachmentsPreview
        groups={[
          {
            id: "group-email",
            label: "Current email",
            items: [
              {
                kind: "loading",
                id: "loading-thread",
                label: "Loading email thread...",
                description: "Preparing context",
              },
            ],
          },
        ]}
        onRemoveFile={() => {}}
      />,
    );

    expect(screen.getByText("Loading email thread...")).toBeVisible();
    expect(screen.getByText("Preparing context")).toBeVisible();
  });

  it("keeps dynamically loaded collapsible groups closed by default", async () => {
    const Harness = () => {
      const [loaded, setLoaded] = useState(false);

      return (
        <>
          <button type="button" onClick={() => setLoaded(true)}>
            Finish loading
          </button>
          <GroupedFileAttachmentsPreview
            groups={[
              loaded
                ? {
                    id: "group-email",
                    label: "Current email",
                    collapsible: true,
                    defaultCollapsed: true,
                    items: [
                      {
                        kind: "attachment",
                        id: "file-1",
                        file: {
                          id: "file-1",
                          filename: "invoice.pdf",
                          size: 2048,
                        },
                      },
                    ],
                  }
                : {
                    id: "group-email-loading",
                    label: "Current email",
                    items: [
                      {
                        kind: "loading",
                        id: "loading-thread",
                        label: "Loading email thread...",
                      },
                    ],
                  },
            ]}
            onRemoveFile={() => {}}
          />
        </>
      );
    };

    await renderWithI18n(<Harness />);

    expect(screen.getByText("Loading email thread...")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Finish loading" }));

    const groupToggle = screen.getByRole("button", {
      name: /current email/i,
    });
    expect(groupToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("invoice")).toBeNull();

    fireEvent.click(groupToggle);

    expect(groupToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("invoice")).toBeVisible();
  });

  it("can keep group headers sticky inside a bounded scroll pane", async () => {
    await renderWithI18n(
      <GroupedFileAttachmentsPreview
        stickyGroupHeaders={true}
        groups={[
          {
            id: "group-email",
            label: "Current email",
            collapsible: true,
            defaultCollapsed: false,
            items: [
              {
                kind: "attachment",
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
        onRemoveFile={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: /current email/i })).toHaveClass(
      "sticky",
      "top-0",
      "border",
    );
  });

  it("renders non-file status rows without removal controls", async () => {
    await renderWithI18n(
      <GroupedFileAttachmentsPreview
        groups={[
          {
            id: "group-email",
            label: "Current email",
            items: [
              {
                kind: "status",
                id: "thread-error",
                tone: "error",
                label: "Couldn't load the email thread",
                description: "You can still send without this email context.",
              },
            ],
          },
        ]}
        onRemoveFile={() => {}}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't load the email thread",
    );
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
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
                kind: "attachment",
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

    fireEvent.click(
      screen.getByRole("button", { name: /remove invoice\.pdf/i }),
    );
    expect(onRemoveFile).toHaveBeenCalledWith("file-1");
  });
});
