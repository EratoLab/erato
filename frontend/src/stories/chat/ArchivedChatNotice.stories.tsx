import { ArchivedChatNotice } from "../../components/ui/Chat/ArchivedChatNotice";
import { ChatContext } from "../../providers/ChatProvider";

import type { ChatContextValue } from "../../providers/ChatProvider";
import type { Meta, StoryObj } from "@storybook/react";

const chatContext = {
  unarchiveChat: async () => undefined,
} as unknown as ChatContextValue;

/**
 * The notice sits in `Chat`'s `topContent` slot, which supplies the border and
 * the page background; the stories reproduce that strip so the spacing reads
 * the way it does in the chat.
 */
const meta: Meta<typeof ArchivedChatNotice> = {
  title: "CHAT/ArchivedChatNotice",
  component: ArchivedChatNotice,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <ChatContext.Provider value={chatContext}>
        <div className="w-full max-w-3xl border-b border-theme-border bg-[var(--theme-shell-page)] p-3 sm:px-4">
          <Story />
        </div>
      </ChatContext.Provider>
    ),
  ],
  args: { chatId: "chat-1" },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A run is restored by the chat that dispatched it, so it offers no way back. */
export const DelegatedRun: Story = {
  args: { variant: "run" },
};
