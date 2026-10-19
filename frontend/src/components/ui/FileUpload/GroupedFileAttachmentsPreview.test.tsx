import { I18nProvider } from "@lingui/react";
import {
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { messages as enMessages } from "@/locales/en/messages.json";

import {
  GroupedFileAttachmentsPreview,
  useGroupedFileAttachmentsPreview,
  type FileAttachmentGroup,
} from "./GroupedFileAttachmentsPreview";

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
  it.each([false, true])(
    "keeps group actions with their disclosure, independently of pagination (sticky: %s)",
    async (stickyGroupHeaders) => {
      const remove = vi.fn();
      await renderWithI18n(
        <GroupedFileAttachmentsPreview
          stickyGroupHeaders={stickyGroupHeaders}
          defaultVisibleItems={1}
          groups={[
            {
              id: "dropped-email",
              label: "Dropped email",
              collapsible: true,
              items: [
                { kind: "status", id: "body", label: "Email body" },
                { kind: "status", id: "file", label: "Attached file" },
              ],
            },
          ]}
          groupActions={{
            "dropped-email": <button onClick={remove}>Remove email</button>,
          }}
        />,
      );

      const toggle = screen.getByRole("button", { name: /dropped email/i });
      expect(screen.queryByRole("button", { name: "Remove email" })).toBeNull();
      fireEvent.click(toggle);
      expect(screen.getByText("Email body")).toBeVisible();
      expect(screen.queryByText("Attached file")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Remove email" }));
      expect(remove).toHaveBeenCalledTimes(1);
      fireEvent.click(
        screen.getByRole("button", { name: /show 1 more item/i }),
      );
      expect(screen.getByText("Attached file")).toBeVisible();
      expect(
        screen.getAllByRole("button", { name: "Remove email" }),
      ).toHaveLength(1);
      fireEvent.click(toggle);
      expect(screen.queryByRole("button", { name: "Remove email" })).toBeNull();
      fireEvent.click(toggle);
      expect(screen.getByText("Attached file")).toBeVisible();
    },
  );

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
    // card's own selected fill would read as the opposite. Only its header
    // dims, so a row inside is not faded twice.
    expect(card).not.toHaveClass("opacity-60");
    expect(card.querySelector('[data-ui="card-header"] > div')).toHaveClass(
      "opacity-60",
    );
    expect(
      card.querySelector('[data-ui="attachment-tile"]')?.closest(".opacity-60"),
    ).toBeNull();
    expect(card).not.toHaveAttribute("data-selected");
  });

  it("carries a thread message's verdict in its header", async () => {
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
                selected: true,
                onToggle: () => {},
                validation: { ok: false, reason: "Too large to send" },
                defaultCollapsed: true,
                attachments: [
                  {
                    id: "file-1",
                    file: { id: "file-1", filename: "raw.zip", size: 2048 },
                    selected: true,
                    onToggle: () => {},
                  },
                ],
              },
              {
                kind: "threadMessageGroup",
                id: "message-2",
                label: "Ben Meier",
                validation: { ok: true },
                attachments: [],
              },
            ],
          },
        ]}
        onRemoveFile={() => {}}
      />,
    );

    const cards = container.querySelectorAll('[data-ui="thread-message-card"]');
    // The reason sits in the header, so it reads while the rows are folded.
    expect(cards[0]).toHaveAttribute("data-invalid", "true");
    expect(screen.getByText("Too large to send")).toBeVisible();
    expect(screen.getByText("Anna Schmidt")).toBeVisible();
    expect(screen.queryByText("raw")).toBeNull();
    // A passing verdict leaves the header as it was.
    expect(cards[1]).not.toHaveAttribute("data-invalid");
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

  const pinnedDropGroup: FileAttachmentGroup = {
    id: "drop",
    label: "Re: Offsite agenda",
    collapsible: true,
    pinActions: true,
    items: [{ kind: "status", id: "body", label: "Email body" }],
  };

  it.each([false, true])(
    "keeps a pinned group action in the header while collapsed (sticky: %s)",
    async (stickyGroupHeaders) => {
      const remove = vi.fn();
      await renderWithI18n(
        <GroupedFileAttachmentsPreview
          stickyGroupHeaders={stickyGroupHeaders}
          groups={[pinnedDropGroup]}
          groupActions={{
            drop: <button onClick={remove}>Remove Re: Offsite agenda</button>,
          }}
        />,
      );

      const toggle = screen.getByRole("button", {
        name: /offsite agenda.*1 item/i,
      });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      const action = screen.getByRole("button", {
        name: "Remove Re: Offsite agenda",
      });
      expect(toggle).not.toContainElement(action);
      expect(
        action.closest('[data-ui="attachment-group-header-actions"]'),
      ).not.toBeNull();
      fireEvent.click(action);
      expect(remove).toHaveBeenCalledTimes(1);

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("Email body")).toBeVisible();
      expect(
        screen.getAllByRole("button", { name: "Remove Re: Offsite agenda" }),
      ).toHaveLength(1);
    },
  );

  it("reports pinned actions from the hook while the group is collapsed", async () => {
    const { i18n } = await import("@lingui/core");
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
    const action = <button>Remove</button>;

    const { result } = renderHook(() =>
      useGroupedFileAttachmentsPreview({
        groups: [
          pinnedDropGroup,
          { ...pinnedDropGroup, id: "unpinned", pinActions: undefined },
        ],
        groupActions: { drop: action, unpinned: action },
      }),
    );

    const [pinned, unpinned] = result.current;
    expect(pinned.isCollapsed).toBe(true);
    expect(pinned.actionsPinned).toBe(true);
    expect(pinned.actions).toBe(action);
    expect(unpinned.actionsPinned).toBe(false);
    expect(unpinned.actions).toBeUndefined();
  });

  it("draws a display-named image upload as a thumbnail", async () => {
    const { container } = await renderWithI18n(
      <GroupedFileAttachmentsPreview
        groups={[
          {
            id: "conversation",
            label: "Product sync",
            items: [
              {
                kind: "attachment",
                id: "image-1",
                file: {
                  id: "image-1",
                  filename: "teams-img-abc.png",
                  displayName: "Image",
                  download_url: "/files/image-1",
                  preview_url: "/files/image-1/preview",
                } as never,
              },
            ],
          },
        ]}
        onRemoveFile={() => {}}
      />,
    );

    const tile = container.querySelector('[data-ui="attachment-tile"]');
    expect(tile?.tagName).toBe("IMG");
    expect(tile).toHaveAttribute("src", "/files/image-1/preview");
    expect(container.querySelector('[data-filetype="image"]')).toContainElement(
      tile as HTMLElement,
    );
  });

  it("gives a display-named image row the image family", async () => {
    const { container } = await renderWithI18n(
      <GroupedFileAttachmentsPreview
        showFileTypes={true}
        groups={[
          {
            id: "conversation",
            label: "Product sync",
            items: [
              {
                kind: "threadMessageGroup",
                id: "message-1",
                label: "Anna Schmidt",
                defaultCollapsed: false,
                attachments: [
                  {
                    id: "image-1",
                    file: {
                      id: "image-1",
                      filename: "teams-img-abc.png",
                      displayName: "Image",
                      preview_url: "/files/image-1/preview",
                    },
                    selected: true,
                    onToggle: () => {},
                  },
                ],
              },
            ],
          },
        ]}
      />,
    );

    const row = container.querySelector('[data-filetype="image"]');
    expect(row).not.toBeNull();
    // Rows stay rows: the type shows, the thumbnail does not.
    expect(row?.querySelector("img")).toBeNull();
    expect(within(row as HTMLElement).getByText(/^IMAGE/)).toBeVisible();
  });

  it("keeps a context item named like an image a document", async () => {
    const { container } = await renderWithI18n(
      <GroupedFileAttachmentsPreview
        groups={[
          {
            id: "reply-context",
            label: "Reply context",
            metaLabel: "",
            items: [
              {
                kind: "context",
                id: "reply-context",
                file: {
                  id: "reply-context",
                  filename: "Fwd: logo.png",
                  displayName: "Fwd: logo.png — Anna",
                },
                labelOverride: "Reply context",
              },
            ],
          },
        ]}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-filetype="image"]')).toBeNull();
  });

  it("keeps extension detection when the stored filename is no image", async () => {
    const { container } = await renderWithI18n(
      <GroupedFileAttachmentsPreview
        groups={[
          {
            id: "conversation",
            label: "Product sync",
            items: [
              {
                kind: "attachment",
                id: "file-1",
                file: {
                  id: "file-1",
                  filename: "teams-file-abc",
                  displayName: "roadmap.png",
                  preview_url: "/files/file-1/preview",
                } as never,
              },
            ],
          },
        ]}
      />,
    );

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/files/file-1/preview",
    );
  });
});
