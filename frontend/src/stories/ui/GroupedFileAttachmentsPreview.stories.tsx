import { GroupedFileAttachmentsPreview } from "../../components/ui/FileUpload/GroupedFileAttachmentsPreview";

import type { Meta, StoryObj } from "@storybook/react";

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
