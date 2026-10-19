import { Button } from "../../components/ui/Controls/Button";
import { GroupedFileAttachmentsPreview } from "../../components/ui/FileUpload/GroupedFileAttachmentsPreview";

import type { Meta, StoryObj } from "@storybook/react";
import type React from "react";

const meta = {
  title: "UI/GroupedFileAttachmentsPreview",
  component: GroupedFileAttachmentsPreview,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="bg-theme-bg-primary p-6">
        <div className="mx-auto max-w-[720px] rounded-lg bg-theme-bg-secondary p-4">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof GroupedFileAttachmentsPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {
  args: {
    groups: [
      {
        id: "email-group",
        label: "Current email",
        items: [
          {
            kind: "attachment",
            id: "body",
            file: {
              id: "body",
              filename: "message-thread.html",
              size: 1400,
            },
          },
          {
            kind: "attachment",
            id: "pdf",
            file: {
              id: "pdf",
              filename: "proposal.pdf",
              size: 82000,
            },
          },
          {
            kind: "attachment",
            id: "xlsx",
            file: {
              id: "xlsx",
              filename: "budget-2026.xlsx",
              size: 9100,
            },
          },
          {
            kind: "attachment",
            id: "docx",
            file: {
              id: "docx",
              filename: "follow-up-notes.docx",
              size: 4300,
            },
          },
        ],
      },
    ],
    onRemoveFile: () => {},
    defaultVisibleItems: 2,
    showFileTypes: true,
  },
};

const threadMessage = (
  id: string,
  label: string,
  sublabel: string,
  attachments: { id: string; filename: string; size: number }[],
  validation?: { ok: boolean; reason?: string },
) => ({
  kind: "threadMessageGroup" as const,
  id,
  label,
  sublabel,
  selected: true,
  onToggle: () => {},
  validation,
  defaultCollapsed: attachments.length === 0,
  attachments: attachments.map((file) => ({
    id: file.id,
    file,
    selected: true,
    onToggle: () => {},
  })),
});

/* Sticky headers only make sense inside a bounded scroll region, which is
   how the Office add-in shows a staged email thread. */
const boundedScroll = (Story: () => React.JSX.Element) => (
  <div className="max-h-[260px] overflow-y-auto pr-1">
    <Story />
  </div>
);

export const StickyThread: Story = {
  decorators: [boundedScroll],
  args: {
    groups: [
      {
        id: "thread",
        label: "Re: Kickoff Kundenportal 2.0 – Lastenheft im Anhang",
        metaLabel: "13 messages",
        collapsible: true,
        defaultCollapsed: false,
        items: [
          threadMessage(
            "m1",
            "Daniel Person",
            "19/05/2026, 18:58:51 · Kickoff Kundenportal 2.0 – Lastenheft im Anhang",
            [
              {
                id: "a1",
                filename: "Lastenheft_Kundenportal_v1.pdf",
                size: 240000,
              },
            ],
          ),
          threadMessage(
            "m2",
            "Max Token",
            "19/05/2026, 19:00:16 · AW: Kickoff Kundenportal 2.0 – Lastenheft im Anhang",
            [],
          ),
          threadMessage(
            "m3",
            "Daniel Person",
            "19/05/2026, 19:00:49 · Re: Kickoff Kundenportal 2.0 – Lastenheft im Anhang",
            [],
          ),
          threadMessage(
            "m4",
            "Max Token",
            "19/05/2026, 19:02:28 · AW: Kickoff Kundenportal 2.0 – Lastenheft im Anhang",
            [
              { id: "a2", filename: "Angebot_v2.xlsx", size: 18000 },
              { id: "a3", filename: "Zeitplan.png", size: 52000 },
            ],
          ),
        ],
      },
    ],
    onRemoveFile: () => {},
    stickyGroupHeaders: true,
    showFileTypes: true,
    defaultVisibleItems: 10,
  },
};

/* A message the composer will not send as it stands carries the verdict in
   its header, beside the attachment rows that carry their own. */
export const StickyThreadInvalid: Story = {
  decorators: [boundedScroll],
  args: {
    groups: [
      {
        id: "thread",
        label: "Re: Kickoff Kundenportal 2.0 – Lastenheft im Anhang",
        metaLabel: "2 messages · 24.3 MB of 20 MB",
        collapsible: true,
        defaultCollapsed: false,
        items: [
          threadMessage(
            "m1",
            "Daniel Person",
            "19/05/2026, 18:58:51 · Kickoff Kundenportal 2.0 – Lastenheft im Anhang",
            [
              {
                id: "a1",
                filename: "Lastenheft_Kundenportal_v1.pdf",
                size: 240000,
              },
            ],
          ),
          {
            ...threadMessage(
              "m2",
              "Max Token",
              "19/05/2026, 19:02:28 · AW: Kickoff Kundenportal 2.0 – Lastenheft im Anhang",
              [
                { id: "a2", filename: "Rohdaten.zip", size: 24000000 },
                { id: "a3", filename: "Zeitplan.png", size: 52000 },
              ],
              { ok: false, reason: "Too large to send as one message" },
            ),
            defaultCollapsed: false,
          },
        ],
      },
    ],
    onRemoveFile: () => {},
    stickyGroupHeaders: true,
    showFileTypes: true,
    defaultVisibleItems: 10,
  },
};

export const StickyThreadLoading: Story = {
  decorators: [boundedScroll],
  args: {
    groups: [
      {
        id: "thread",
        label: "Re: Kickoff Kundenportal 2.0 – Lastenheft im Anhang",
        metaLabel: "",
        collapsible: true,
        defaultCollapsed: false,
        items: [
          {
            kind: "loading",
            id: "thread-loading",
            label: "Loading email thread...",
            description: "Preparing the email context",
          },
        ],
      },
    ],
    onRemoveFile: () => {},
    stickyGroupHeaders: true,
  },
};

export const WithLoading: Story = {
  args: {
    groups: [
      {
        id: "email-group",
        label: "Current email",
        items: [
          {
            kind: "attachment",
            id: "body",
            file: {
              id: "body",
              filename: "message-thread.html",
              size: 1400,
            },
          },
          {
            kind: "loading",
            id: "loading-attachment",
          },
        ],
      },
    ],
    onRemoveFile: () => {},
    defaultVisibleItems: 2,
    showFileTypes: true,
  },
};

/* The Outlook add-in's dropped-email card: Remove sits beside the disclosure,
   so a collapsed drop can still be removed in one click. */
const droppedEmail = (subject: string) => ({
  groups: [
    {
      id: "drop",
      label: subject,
      metaLabel: "2 items · 96 KB of 25 MB",
      collapsible: true,
      defaultCollapsed: true,
      pinActions: true,
      items: [
        {
          kind: "selectableAttachment" as const,
          id: "body",
          file: { id: "body", filename: `${subject}.eml`, size: 14000 },
          selected: true,
          onToggle: () => {},
          labelOverride: "Email body",
        },
        {
          kind: "selectableAttachment" as const,
          id: "agenda",
          file: { id: "agenda", filename: "agenda.pdf", size: 82000 },
          selected: true,
          onToggle: () => {},
        },
      ],
    },
  ],
  groupActions: {
    drop: (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start px-0 text-xs"
        aria-label={`Remove ${subject}`}
      >
        Remove
      </Button>
    ),
  },
  stickyGroupHeaders: true,
  showFileTypes: true,
  defaultVisibleItems: 10,
});

export const PinnedGroupAction: Story = {
  args: droppedEmail("Re: Offsite agenda"),
};

export const PinnedGroupActionLongSubject: Story = {
  args: droppedEmail(
    "Re: AW: Offsite agenda for the leadership team, travel booking, room plan and the catering order",
  ),
};

/* An unticked message sends nothing, so its attachment boxes read unticked
   with it. */
export const ThreadMessageUnticked: Story = {
  args: {
    groups: [
      {
        id: "thread",
        label: "Re: Kickoff Kundenportal 2.0",
        metaLabel: "2 messages · 240 KB of 25 MB",
        collapsible: true,
        defaultCollapsed: false,
        items: [
          {
            ...threadMessage(
              "m1",
              "Daniel Person",
              "19/05/2026, 18:58:51 · Kickoff Kundenportal 2.0",
              [
                { id: "a1", filename: "Lastenheft.pdf", size: 240000 },
                { id: "a2", filename: "Zeitplan.xlsx", size: 18000 },
              ],
            ),
            selected: false,
            defaultCollapsed: false,
            attachments: [
              { id: "a1", filename: "Lastenheft.pdf", size: 240000 },
              { id: "a2", filename: "Zeitplan.xlsx", size: 18000 },
            ].map((file) => ({
              id: file.id,
              file,
              selected: false,
              onToggle: () => {},
            })),
          },
          threadMessage(
            "m2",
            "Max Token",
            "19/05/2026, 19:00:16 · AW: Kickoff Kundenportal 2.0",
            [],
          ),
        ],
      },
    ],
    onRemoveFile: () => {},
    stickyGroupHeaders: true,
    showFileTypes: true,
    defaultVisibleItems: 10,
  },
};

// A 1x1 PNG, so the thumbnail loads without a network.
const PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const teamsImage = (id: string) => ({
  id,
  filename: `teams-img-${id}.png`,
  displayName: "Image",
  download_url: PIXEL_PNG,
  preview_url: PIXEL_PNG,
  file_contents_unavailable_missing_permissions: false,
  is_sharepoint_file: false,
});

/* Teams names an inline image "Image"; its stored filename keeps the type, so
   it still draws as a thumbnail, and as an image row in a picked message. */
export const DisplayNamedImage: Story = {
  args: {
    groups: [
      {
        id: "conversation",
        label: "Product sync",
        metaLabel: "Whole conversation",
        items: [
          {
            kind: "attachment",
            id: "transcript",
            file: {
              id: "transcript",
              filename: "teams-Product_sync.md",
              displayName: "All messages",
            },
          },
          { kind: "attachment", id: "img-1", file: teamsImage("abc") },
        ],
      },
      {
        id: "picked",
        label: "Picked messages",
        metaLabel: "1 message",
        items: [
          {
            kind: "threadMessageGroup",
            id: "message-1",
            label: "Anna Schmidt",
            sublabel: "Here is the dashboard",
            defaultCollapsed: false,
            attachments: [
              {
                id: "img-2",
                file: teamsImage("def"),
                selected: true,
                onToggle: () => {},
              },
            ],
          },
        ],
      },
    ],
    onRemoveFile: () => {},
    showFileTypes: true,
  },
};
