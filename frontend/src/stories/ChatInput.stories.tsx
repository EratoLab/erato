import { action } from "@storybook/addon-actions";

import { ChatInput } from "../components/ui/Chat/ChatInput";

import type { Meta, StoryObj } from "@storybook/react";

// export const WithCustomTheme: Story = {
//   parameters: {
//     themes: {
//       theme: 'dark', // or 'light'
//     },
//   },
// };

const meta = {
  title: "UI/ChatInput",
  component: ChatInput,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: "ChatGPT-style input with controls and responsive design",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    onSendMessage: { action: "message sent" },
    onAddFile: {
      action: "add files",
      description: "Callback when files are added",
    },
    onRegenerate: { action: "regenerate" },
    isLoading: { control: "boolean" },
    disabled: { control: "boolean" },
    showControls: { control: "boolean" },
    acceptedFileTypes: { control: "text" },
  },
  decorators: [
    (Story) => (
      <div className="w-[768px] bg-white rounded-2xl p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatInput>;

export default meta;
type Story = StoryObj<typeof meta>;

const defaultArgs = {
  onSendMessage: action("onSendMessage"),
};

export const Default: Story = {
  args: {
    onSendMessage: action("message sent"),
    showControls: true,
    onAddFile: action("add files"),
    onRegenerate: action("regenerate"),
  },
};

export const Loading: Story = {
  args: {
    onSendMessage: action("message sent"),
    isLoading: true,
    showControls: true,
    onAddFile: action("add files"),
    onRegenerate: action("regenerate"),
  },
};

export const WithoutControls: Story = {
  args: {
    onSendMessage: action("message sent"),
    showControls: false,
  },
};

export const WithCustomPlaceholder: Story = {
  args: {
    placeholder: "Ask me anything...",
    ...defaultArgs,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    ...defaultArgs,
  },
};

export const WithCustomClassName: Story = {
  args: {
    className: "bg-gray-100",
    ...defaultArgs,
  },
};
