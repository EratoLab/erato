import { DelegatedRunHeader } from "../../components/ui/Chat/DelegatedRunHeader";

import type { Meta, StoryObj } from "@storybook/react";

/**
 * The header sits in `Chat`'s `topContent` slot, which supplies the border and
 * the page background; the stories reproduce that strip so the spacing reads
 * the way it does in the chat.
 */
const meta: Meta<typeof DelegatedRunHeader> = {
  title: "CHAT/DelegatedRunHeader",
  component: DelegatedRunHeader,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-full max-w-3xl border-b border-theme-border bg-[var(--theme-shell-page)] p-3 sm:px-4">
        <Story />
      </div>
    ),
  ],
  args: {
    provenanceKind: "delegation",
    assistantName: "Research Helper",
    originChatId: "origin-1",
    originChatTitle: "Quarterly planning",
    originAssistantId: "assistant-9",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Provenance only: the run was dispatched without a structured brief. */
export const Default: Story = {};

export const WithRunParameters: Story = {
  args: {
    expectedOutput: "A bullet list of file names, one per line.",
    constraints: "Use only the attachments passed with the task.",
  },
};

export const ExpectedOutputOnly: Story = {
  args: {
    expectedOutput: "A single paragraph, no more than 80 words.",
  },
};

/** The delegate is still writing; the run refuses messages until it finishes. */
export const StillRunning: Story = {
  args: {
    expectedOutput: "A bullet list of file names, one per line.",
    isRunning: true,
  },
};

/** Archived, possibly by the cascade from the chat that dispatched it. */
export const Archived: Story = {
  args: {
    constraints: "Use only the attachments passed with the task.",
    isArchived: true,
  },
};

/** The origin chat was deleted: a label, never a link to a dead chat. */
export const DeletedOrigin: Story = {
  args: {
    originChatTitle: undefined,
    originAssistantId: undefined,
  },
};

/** A long brief wraps rather than pushing the conversation off-screen. */
export const LongParameters: Story = {
  args: {
    expectedOutput:
      "A table with one row per invoice: number, issue date, net amount, VAT rate and the account it should be booked against. Sort by issue date, oldest first.",
    constraints:
      "Do not open anything that was not attached to the task. If a figure is missing, say so in the row instead of estimating it.",
  },
};
