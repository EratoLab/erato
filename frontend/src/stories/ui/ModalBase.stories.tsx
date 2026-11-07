import { useState } from "react";

import { Button } from "../../components/ui/Controls/Button";
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

const EndedAlertDialog = () => {
  const [open, setOpen] = useState(true);
  return (
    <ModalBase
      isOpen={open}
      onClose={() => setOpen(false)}
      role="alertdialog"
      labelledBy="story-ended-title"
      describedBy="story-ended-body"
      closeOnOverlayClick={false}
      contentClassName="[--theme-layout-modal-max-width:27.5rem]"
    >
      <div className="flex flex-col gap-3">
        <h2
          id="story-ended-title"
          className="font-heading text-base font-semibold text-theme-fg-primary"
        >
          Diese Anfrage wurde abgebrochen.
        </h2>
        <p id="story-ended-body" className="text-sm text-theme-fg-secondary">
          Es wurde nichts geteilt.
        </p>
        <div className="flex justify-end">
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the alert dialog's one action */}
          <Button variant="secondary" autoFocus onClick={() => setOpen(false)}>
            Schließen
          </Button>
        </div>
      </div>
    </ModalBase>
  );
};

/* A headerless alert dialog with one action: no close button, a scrim click
   does nothing, Escape still closes. Named and described by its own content. */
export const AlertDialog: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    children: null,
  },
  render: () => <EndedAlertDialog />,
};
