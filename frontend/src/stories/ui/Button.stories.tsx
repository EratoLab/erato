import {
  ArrowUpIcon,
  PlusIcon,
  ArrowPathIcon,
  ClipboardDocumentIcon,
  HandThumbUpIcon,
  HandThumbDownIcon,
} from "@heroicons/react/24/outline";

import { Button } from "../../components/ui/Controls/Button";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Button",
  component: Button,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A flexible button component supporting different variants, sizes, and icon integration.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "secondary", "ghost"],
      description: "Visual style variant",
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
      description: "Button size",
    },
  },
  decorators: [
    (Story) => (
      <div className="p-8 bg-theme-bg-primary">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    variant: "primary",
    children: "Button",
  },
};

export const Secondary: Story = {
  args: {
    variant: "secondary",
    children: "Button",
  },
};

export const WithIcon: Story = {
  args: {
    variant: "secondary",
    icon: <PlusIcon />,
    children: "New Chat",
  },
};

export const IconOnly: Story = {
  args: {
    variant: "secondary",
    icon: <ArrowUpIcon />,
    "aria-label": "Send message",
  },
};

export const Disabled: Story = {
  args: {
    variant: "primary",
    children: "Button",
    disabled: true,
  },
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
};

export const MessageControls: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        icon={<ClipboardDocumentIcon />}
        aria-label="Copy"
      />
      <Button
        size="sm"
        variant="ghost"
        icon={<HandThumbUpIcon />}
        aria-label="Like"
      />
      <Button
        size="sm"
        variant="ghost"
        icon={<HandThumbDownIcon />}
        aria-label="Dislike"
      />
      <Button
        size="sm"
        variant="ghost"
        icon={<ArrowPathIcon />}
        aria-label="Regenerate"
      />
    </div>
  ),
};

export const ChatControls: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" icon={<PlusIcon />}>
        New Chat
      </Button>
      <Button size="sm" variant="secondary" icon={<ArrowPathIcon />}>
        Regenerate
      </Button>
    </div>
  ),
};
