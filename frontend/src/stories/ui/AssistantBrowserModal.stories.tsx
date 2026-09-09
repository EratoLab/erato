import { AssistantBrowserModal } from "@/components/ui/Chat/AssistantBrowserModal";

import type { Meta, StoryObj } from "@storybook/react";

/**
 * The mention browser's option list. It is the first consumer of
 * `Row variant="list"`, and the reason the variant exists: these rows used to
 * carry no geometry class at all, so their hover and focus fills painted
 * square and full-bleed inside a rounded, bordered well, and no customer theme
 * could reach them.
 */
const meta = {
  title: "UI/AssistantBrowserModal",
  component: AssistantBrowserModal,
  parameters: { layout: "centered" },
} satisfies Meta<typeof AssistantBrowserModal>;

export default meta;
type Story = StoryObj<typeof meta>;

const ASSISTANTS = [
  {
    id: "pirate-2",
    name: "Pirate 2",
    description: undefined,
    ownerEmail: "maxgoisser@maxgoisser.onmicrosoft.com",
  },
  {
    id: "pirate",
    name: "Pirate",
    description: "Answer like a pirate",
    ownerEmail: "maxgoisser@maxgoisser.onmicrosoft.com",
  },
  {
    id: "researcher",
    name: "Researcher",
    description: "Digs through sources before answering",
    ownerEmail: "maxgoisser@maxgoisser.onmicrosoft.com",
  },
];

export const Options: Story = {
  args: {
    isOpen: true,
    onClose: () => {},
    assistants: ASSISTANTS,
    onSelect: () => {},
  },
};
