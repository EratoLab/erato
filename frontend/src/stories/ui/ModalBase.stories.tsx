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

/* A file preview opened from a Teams conversation stacks two dialogs; each is
   named by its own title. */
export const Stacked: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    title: "Teams conversation",
    children: null,
  },
  render: (args) => (
    <>
      <ModalBase {...args}>
        <p className="text-sm text-theme-fg-secondary">
          Anna Schmidt: Here is the dashboard.
        </p>
      </ModalBase>
      <ModalBase isOpen onClose={() => {}} title="Preview: dashboard.png">
        <p className="text-sm text-theme-fg-secondary">dashboard.png</p>
      </ModalBase>
    </>
  ),
};
