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
    layout: "fullscreen",
    docs: {
      description: {
        component: "ChatGPT-style input with controls and responsive design",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    onSendMessage: { action: "message sent" },
    handleFileAttachments: {
      action: "handle file attachments",
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
      <div className="flex h-screen w-full items-center justify-center bg-theme-bg-primary p-0">
        <div className="flex size-full items-center justify-center rounded-lg bg-theme-bg-tertiary p-4 shadow-lg md:w-4/5 lg:w-3/4 xl:w-2/3">
          <div className="w-full max-w-full">
            <Story />
          </div>
        </div>
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
    handleFileAttachments: action("handle file attachments"),
    onRegenerate: action("regenerate"),
    showFileTypes: true,
    initialFiles: [],
  },
  parameters: {
    viewport: {
      defaultViewport: "desktop",
    },
  },
};

export const Loading: Story = {
  args: {
    onSendMessage: action("message sent"),
    isLoading: true,
    showControls: true,
    handleFileAttachments: action("handle file attachments"),
    onRegenerate: action("regenerate"),
    showFileTypes: true,
    initialFiles: [],
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

export const Mobile: Story = {
  args: {
    onSendMessage: action("message sent"),
    showControls: true,
    handleFileAttachments: action("handle file attachments"),
    onRegenerate: action("regenerate"),
    showFileTypes: true,
    initialFiles: [],
  },
  parameters: {
    viewport: {
      defaultViewport: "mobile",
    },
  },
};

export const Tablet: Story = {
  args: {
    onSendMessage: action("message sent"),
    showControls: true,
    handleFileAttachments: action("handle file attachments"),
    onRegenerate: action("regenerate"),
    showFileTypes: true,
    initialFiles: [],
  },
  parameters: {
    viewport: {
      defaultViewport: "tablet",
    },
  },
};
