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
    expect(screen.getByText("message.html")).toBeVisible();
    expect(screen.getByText("invoice.pdf")).toBeVisible();
    expect(screen.queryByText("notes.docx")).toBeNull();
    expect(
      screen.getByRole("button", { name: /show 1 more item/i }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /show 1 more item/i }));

    expect(screen.getByText("notes.docx")).toBeVisible();
  });

  it("renders loading items as a bare spinner with an accessible label", async () => {
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

    // A status region takes its name from an author label, not its content,
    // so the spinner's screen-reader text is asserted as text.
    expect(screen.getByText(/loading attachment/i)).toBeInTheDocument();
    expect(screen.queryByText(/please wait/i)).not.toBeInTheDocument();
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
    expect(screen.queryByText("invoice.pdf")).toBeNull();

    fireEvent.click(groupToggle);

    expect(groupToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("invoice.pdf")).toBeVisible();
  });

  it("keeps each group at its own default when several are shown at once", async () => {
    const group = (id: string, defaultCollapsed: boolean) => ({
      id,
      label: id,
      collapsible: true,
      defaultCollapsed,
      items: [
        {
          kind: "attachment" as const,
          id: `${id}-file`,
          file: { id: `${id}-file`, filename: "invoice.pdf", size: 2048 },
        },
      ],
    });

    await renderWithI18n(
      <GroupedFileAttachmentsPreview
        groups={[
          group("closed-a", true),
          group("open-b", false),
          group("closed-c", true),
        ]}
        onRemoveFile={() => {}}
        defaultVisibleItems={10}
        stickyGroupHeaders={true}
      />,
    );

    expect(screen.getByRole("button", { name: /closed-a/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: /open-b/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: /closed-c/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("opens a row through onOpen instead of previewing its file", async () => {
    const onOpen = vi.fn();
    const onFilePreview = vi.fn();

    await renderWithI18n(
      <GroupedFileAttachmentsPreview
        groups={[
          {
            id: "group-teams",
            label: "Product sync",
            items: [
              {
                kind: "attachment",
                id: "transcript",
                file: {
                  id: "transcript",
                  filename: "teams-Product_sync.md",
                  displayName: "All messages",
                },
                onOpen,
              },
            ],
          },
        ]}
        onRemoveFile={() => {}}
        onFilePreview={onFilePreview}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open all messages/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onFilePreview).not.toHaveBeenCalled();
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
      "border-b",
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

  it("renders a thread message without checkboxes when it cannot be toggled", async () => {
    const { container } = await renderWithI18n(
      <GroupedFileAttachmentsPreview
        groups={[
          {
            id: "group-conversation",
            label: "Project Alpha",
            items: [
              {
                kind: "threadMessageGroup",
                id: "message-1",
                label: "Anna Schmidt",
                sublabel: "5 August 2026, 14:22",
                defaultCollapsed: false,
                attachments: [
                  {
                    id: "file-1",
                    file: { id: "file-1", filename: "invoice.pdf", size: 2048 },
                  },
                ],
              },
            ],
          },
        ]}
        onRemoveFile={() => {}}
      />,
    );

    expect(screen.getByText("Anna Schmidt")).toBeVisible();
    expect(screen.getByText("invoice")).toBeVisible();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(
      container.querySelector('[data-ui="attachment-tile"]'),
    ).not.toHaveAttribute("data-selected");
  });

  it("reports the selection on toggleable attachment rows", async () => {
    const { container } = await renderWithI18n(
      <GroupedFileAttachmentsPreview
        groups={[
          {
            id: "group-email",
            label: "Current email",
            items: [
              {
                kind: "selectableAttachment",
                id: "file-1",
                file: { id: "file-1", filename: "invoice.pdf", size: 2048 },
                selected: true,
                onToggle: () => {},
              },
              {
                kind: "selectableAttachment",
                id: "file-2",
                file: { id: "file-2", filename: "notes.docx", size: 4096 },
                selected: false,
                onToggle: () => {},
              },
            ],
          },
        ]}
        onRemoveFile={() => {}}
      />,
    );

    const tiles = container.querySelectorAll('[data-ui="attachment-tile"]');
    expect(tiles[0]).toHaveAttribute("data-selected", "true");
    expect(tiles[1]).not.toHaveAttribute("data-selected");
  });

  it("announces a failed attachment and still lets it be toggled", async () => {
    const onToggle = vi.fn();

    const { container } = await renderWithI18n(
      <GroupedFileAttachmentsPreview
        groups={[
          {
            id: "group-email",
            label: "Current email",
            items: [
              {
                kind: "selectableAttachment",
                id: "file-1",
                file: { id: "file-1", filename: "invoice.pdf", size: 2048 },
                selected: true,
                onToggle,
                validation: { ok: false, reason: "Too large to attach" },
              },
            ],
          },
        ]}
        onRemoveFile={() => {}}
      />,
    );

    expect(
      container.querySelector('[data-ui="attachment-tile"]'),
    ).toHaveAttribute("data-invalid", "true");
    expect(screen.getByText("Too large to attach")).toBeVisible();

    // Failing validation warns rather than decides: the file can still be
    // checked, so the checkbox has to stay live.
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("keeps the selection off a preview row that owns no toggle", async () => {
    const { container } = await renderWithI18n(
      <GroupedFileAttachmentsPreview
        groups={[
          {
            id: "group-conversation",
            label: "Project Alpha",
            items: [
              {
                kind: "threadMessageGroup",
                id: "message-1",
                label: "Anna Schmidt",
                defaultCollapsed: false,
                attachments: [
                  {
                    id: "file-1",
                    file: { id: "file-1", filename: "invoice.pdf", size: 2048 },
                    selected: true,
                    onToggle: () => {},
                  },
                  {
                    id: "file-2",
                    file: { id: "file-2", filename: "notes.docx", size: 4096 },
                    selected: true,
                  },
                ],
              },
            ],
          },
        ]}
        onRemoveFile={() => {}}
        onFilePreview={() => {}}
      />,
    );

    const tiles = container.querySelectorAll('[data-ui="attachment-tile"]');
    expect(tiles[0]).toHaveAttribute("data-selected", "true");
    // A read-only row still defaults to `selected`; without a toggle it has
    // nothing to report.
    expect(tiles[1]).not.toHaveAttribute("data-selected");
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

  it("frames a group as a card that keeps its own corner channel", async () => {
    const { container } = await renderWithI18n(
      <GroupedFileAttachmentsPreview
        groups={[
          {
            id: "group-email",
            label: "Current email",
            items: [
              {
                kind: "attachment",
                id: "file-1",
                file: { id: "file-1", filename: "invoice.pdf", size: 2048 },
              },
            ],
          },
        ]}
        onRemoveFile={() => {}}
      />,
    );

    const group = container.querySelector('[data-ui="attachment-group"]')!;

    expect(group.tagName).toBe("SECTION");
    // The corner is the card family's, but the value is the group's: a theme
    // moves this frame with radius.input, not radius.card.
    expect(group).toHaveClass("card-geometry", "attachment-group-geometry");
    // Without sticky headers the frame carries the inset itself, so the body
    // must not pad a second time.
    expect(group).toHaveClass("attachment-group-frame-geometry");
    expect(group.querySelector('[data-ui="card-body"]')).toHaveClass("p-0");
  });

  it("moves the group inset onto the bands when headers are sticky", async () => {
    const { container } = await renderWithI18n(
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
                file: { id: "file-1", filename: "invoice.pdf", size: 2048 },
              },
            ],
          },
        ]}
        onRemoveFile={() => {}}
      />,
    );

    const group = container.querySelector('[data-ui="attachment-group"]')!;

    // A padded frame would leave a strip of it showing beside the header once
    // the header sticks, so the inset moves to the header and the items.
    expect(group).not.toHaveClass("attachment-group-frame-geometry");
    expect(group).toHaveClass("overflow-clip");
    expect(group.querySelector('[data-ui="card-body"]')).toHaveClass(
      "attachment-group-items-geometry",
    );
  });

  it("nests a thread message card inside the group's corner", async () => {
    const { container } = await renderWithI18n(
      <GroupedFileAttachmentsPreview
        groups={[
          {
            id: "group-conversation",
            label: "Project Alpha",
            items: [
              {
                kind: "threadMessageGroup",
                id: "message-1",
                label: "Anna Schmidt",
                selected: false,
                onToggle: () => {},
                defaultCollapsed: false,
                attachments: [
                  {
                    id: "file-1",
                    file: { id: "file-1", filename: "invoice.pdf", size: 2048 },
                    selected: true,
                  },
                ],
              },
            ],
          },
        ]}
        onRemoveFile={() => {}}
      />,
    );

    const card = container.querySelector('[data-ui="thread-message-card"]')!;

    // The corner and the inset both come from the group frame, and the chips
    // inside derive from the card in turn.
    expect(card).toHaveClass("card-nested", "thread-message-card-geometry");
    // A message left out of the upload is dimmed rather than deselected: the
    // card's own selected fill would read as the opposite.
    expect(card).toHaveClass("opacity-60");
    expect(card).not.toHaveAttribute("data-selected");
  });

  it("drops a collapsed thread message's rows from the DOM", async () => {
    const { container } = await renderWithI18n(
      <GroupedFileAttachmentsPreview
        groups={[
          {
            id: "group-conversation",
            label: "Project Alpha",
            items: [
              {
                kind: "threadMessageGroup",
                id: "message-1",
                label: "Anna Schmidt",
                defaultCollapsed: true,
                attachments: [
                  {
                    id: "file-1",
                    file: { id: "file-1", filename: "invoice.pdf", size: 2048 },
                    selected: true,
                  },
                ],
              },
            ],
          },
        ]}
        onRemoveFile={() => {}}
      />,
    );

    // Height alone would leave the rows in the tab order and in the
    // accessibility tree, and their previews would still be fetched.
    expect(container.querySelector('[data-ui="attachment-tile"]')).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /toggle attachments anna schmidt/i }),
    );

    expect(
      container.querySelector('[data-ui="attachment-tile"]'),
    ).not.toBeNull();
  });
});
