import { useState } from "react";

import { ModalBase } from "../../components/ui/Modal/ModalBase";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Modal/ModalBase",
  component: ModalBase,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ModalBase>;

export default meta;
type Story = StoryObj<typeof meta>;

const StackedDialogs = () => {
  const [conversationOpen, setConversationOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(true);
  return (
    <>
      <ModalBase
        isOpen={conversationOpen}
        onClose={() => setConversationOpen(false)}
        title="Teams conversation"
      >
        <p className="text-sm text-theme-fg-secondary">
          Anna Schmidt: Here is the dashboard.
        </p>
      </ModalBase>
      <ModalBase
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Preview: dashboard.png"
      >
        <p className="text-sm text-theme-fg-secondary">dashboard.png</p>
      </ModalBase>
    </>
  );
};

/* A file preview opened from a Teams conversation stacks two dialogs; each is
   named by its own title, and Escape closes the newest one only. */
export const Stacked: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    title: "Teams conversation",
    children: null,
  },
  render: () => <StackedDialogs />,
};
