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
) => ({
  kind: "threadMessageGroup" as const,
  id,
  label,
  sublabel,
  selected: true,
  onToggle: () => {},
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
