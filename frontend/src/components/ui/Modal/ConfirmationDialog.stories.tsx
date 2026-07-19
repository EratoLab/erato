import { ConfirmationDialog } from "./ConfirmationDialog";
import { Button } from "../Controls/Button";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Modal/ConfirmationDialog",
  component: ConfirmationDialog,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Modal confirm/cancel dialog rendered on ModalBase. The frontend's " +
          'data-loss / destructive safety-confirm idiom — e.g. the "Remove this ' +
          'chat?" guard. Also embedded inside Button via its `confirmAction` props.',
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    confirmButtonVariant: {
      control: "select",
      options: ["primary", "danger", "secondary"],
      description: "Visual style of the confirm button",
    },
  },
  args: {
    onClose: () => {},
    onConfirm: () => {},
  },
} satisfies Meta<typeof ConfirmationDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default confirm dialog with a primary confirm button.
 */
export const Open: Story = {
  args: {
    isOpen: true,
    title: "Save changes?",
    message: "Your edits to this assistant will be applied immediately.",
  },
};

/**
 * Destructive variant — danger-styled confirm button for irreversible actions.
 */
export const Danger: Story = {
  args: {
    isOpen: true,
    title: "Confirm Removal",
    message:
      "Are you sure you want to remove this chat? This cannot be undone.",
    confirmButtonText: "Remove",
    confirmButtonVariant: "danger",
  },
};

/**
 * `message` accepts a ReactNode, not just a string.
 */
export const RichMessage: Story = {
  args: {
    isOpen: true,
    title: "Delete 3 files?",
    confirmButtonText: "Delete",
    confirmButtonVariant: "danger",
    message: (
      <div className="space-y-2 text-sm text-theme-fg-secondary">
        <p>The following files will be permanently deleted:</p>
        <ul className="list-disc pl-5">
          <li>quarterly-report.pdf</li>
          <li>budget-2026.xlsx</li>
          <li>meeting-notes.docx</li>
        </ul>
      </div>
    ),
  },
};

/**
 * How it surfaces today — the destructive-action safety guard.
 *
 * A real `Button` configured with its built-in `confirmAction` /`confirmTitle` /
 * `confirmMessage` props pops the `ConfirmationDialog` on click. This is exactly
 * how the "Remove" chat-history action guards a data-loss operation
 * (ChatHistoryList.tsx:189) — the dialog is owned by the Button, not the caller.
 */
export const SurfacedViaButton: Story = {
  // args satisfy the Meta<ConfirmationDialog> shape; this story renders a Button
  // that owns its own ConfirmationDialog, so these values are unused directly.
  args: {
    isOpen: false,
    title: "Confirm Removal",
    message: "Are you sure you want to remove this chat?",
  },
  render: () => (
    <Button
      variant="danger"
      confirmAction
      confirmTitle="Confirm Removal"
      confirmMessage="Are you sure you want to remove this chat?"
      onClick={() => {}}
    >
      Remove chat
    </Button>
  ),
};
