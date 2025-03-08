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
      <div className="bg-theme-bg-primary p-8">
        <div className="flex items-center gap-8 text-theme-fg-primary">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

const IconWrapper = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded bg-theme-bg-secondary p-4">{children}</div>
);

// Base story type for all icons
type IconStory = StoryObj<typeof CopyIcon>;

// Individual icon stories
export const Copy: IconStory = {
  render: () => (
    <IconWrapper>
      <CopyIcon className="size-6" />
    </IconWrapper>
  ),
};

export const Edit: IconStory = {
  render: () => (
    <IconWrapper>
      <EditIcon className="size-6" />
    </IconWrapper>
  ),
};

export const ThumbUp: IconStory = {
  render: () => (
    <IconWrapper>
      <ThumbUpIcon className="size-6" />
    </IconWrapper>
  ),
};

export const ThumbDown: IconStory = {
  render: () => (
    <IconWrapper>
      <ThumbDownIcon className="size-6" />
    </IconWrapper>
  ),
};

export const Rerun: IconStory = {
  render: () => (
    <IconWrapper>
      <RerunIcon className="size-6" />
    </IconWrapper>
  ),
};

// Size variations
export const Sizes: IconStory = {
  render: () => (
    <IconWrapper>
      <div className="flex items-center gap-4">
        <CopyIcon className="size-4" />
        <CopyIcon className="size-6" />
        <CopyIcon className="size-8" />
      </div>
    </IconWrapper>
  ),
};

// Color variations
export const Colors: IconStory = {
  render: () => (
    <IconWrapper>
      <div className="flex items-center gap-4">
        <CopyIcon className="size-6 text-blue-500" />
        <CopyIcon className="size-6 text-green-500" />
        <CopyIcon className="size-6 text-red-500" />
      </div>
    </IconWrapper>
  ),
};

// All icons together
export const AllIcons: IconStory = {
  render: () => (
    <IconWrapper>
      <div className="flex items-center gap-4">
        <CopyIcon className="size-6" />
        <EditIcon className="size-6" />
        <ThumbUpIcon className="size-6" />
        <ThumbDownIcon className="size-6" />
        <RerunIcon className="size-6" />
      </div>
    </IconWrapper>
  ),
};
