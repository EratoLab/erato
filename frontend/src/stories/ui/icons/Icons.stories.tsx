import {
  CopyIcon,
  EditIcon,
  ThumbUpIcon,
  ThumbDownIcon,
  RerunIcon,
} from "../../../components/ui/icons";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Icons",
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "light",
    },
    docs: {
      description: {
        component: `
Feather-based SVG icons used throughout the chat interface.

## Technical Notes
- SVG icons with consistent 24x24 viewBox
- Inherits current text color via currentColor
- Configurable stroke width and size via className
- Optimized for crisp rendering at small sizes
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="p-8 bg-theme-bg-primary">
        <div className="flex gap-8 items-center text-theme-fg-primary">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

const IconWrapper = ({ children }: { children: React.ReactNode }) => (
  <div className="p-4 bg-theme-bg-secondary rounded">{children}</div>
);

// Base story type for all icons
type IconStory = StoryObj<typeof CopyIcon>;

// Individual icon stories
export const Copy: IconStory = {
  render: () => (
    <IconWrapper>
      <CopyIcon className="w-6 h-6" />
    </IconWrapper>
  ),
};

export const Edit: IconStory = {
  render: () => (
    <IconWrapper>
      <EditIcon className="w-6 h-6" />
    </IconWrapper>
  ),
};

export const ThumbUp: IconStory = {
  render: () => (
    <IconWrapper>
      <ThumbUpIcon className="w-6 h-6" />
    </IconWrapper>
  ),
};

export const ThumbDown: IconStory = {
  render: () => (
    <IconWrapper>
      <ThumbDownIcon className="w-6 h-6" />
    </IconWrapper>
  ),
};

export const Rerun: IconStory = {
  render: () => (
    <IconWrapper>
      <RerunIcon className="w-6 h-6" />
    </IconWrapper>
  ),
};

// Size variations
export const Sizes: IconStory = {
  render: () => (
    <IconWrapper>
      <div className="flex items-center gap-4">
        <CopyIcon className="w-4 h-4" />
        <CopyIcon className="w-6 h-6" />
        <CopyIcon className="w-8 h-8" />
      </div>
    </IconWrapper>
  ),
};

// Color variations
export const Colors: IconStory = {
  render: () => (
    <IconWrapper>
      <div className="flex items-center gap-4">
        <CopyIcon className="w-6 h-6 text-blue-500" />
        <CopyIcon className="w-6 h-6 text-green-500" />
        <CopyIcon className="w-6 h-6 text-red-500" />
      </div>
    </IconWrapper>
  ),
};

// All icons together
export const AllIcons: IconStory = {
  render: () => (
    <IconWrapper>
      <div className="flex items-center gap-4">
        <CopyIcon className="w-6 h-6" />
        <EditIcon className="w-6 h-6" />
        <ThumbUpIcon className="w-6 h-6" />
        <ThumbDownIcon className="w-6 h-6" />
        <RerunIcon className="w-6 h-6" />
      </div>
    </IconWrapper>
  ),
};
