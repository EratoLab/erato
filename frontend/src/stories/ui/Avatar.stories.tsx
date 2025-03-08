import { Avatar } from "../../components/ui/Feedback/Avatar";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Avatar",
  component: Avatar,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
Avatar component that displays user profile images with intelligent fallbacks:
- Uses avatar URL if provided
- Falls back to initials from first and last name if available
- Falls back to first letter of username if available
- Defaults to 'E' for Erato if no user data is present

## Features
- Next.js Image optimization
- Responsive sizing (sm, md, lg)
- Memoized to prevent unnecessary re-renders
- Maintains consistent dimensions to prevent CLS
`,
      },
    },
  },
  argTypes: {
    size: {
      control: "radio",
      options: ["sm", "md", "lg"],
      description: "Size variant of the avatar",
    },
    userProfile: {
      control: "object",
      description: "User profile data for avatar display",
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithImage: Story = {
  args: {
    userProfile: {
      id: "1",
      username: "johndoe",
      firstName: "John",
      lastName: "Doe",
      avatarUrl: "https://i.pravatar.cc/300",
      preferred_language: "en",
    },
    size: "md",
  },
};

export const WithNameInitials: Story = {
  args: {
    userProfile: {
      id: "2",
      username: "johndoe",
      firstName: "John",
      lastName: "Doe",
      preferred_language: "en",
    },
    size: "md",
  },
};

export const WithUsername: Story = {
  args: {
    userProfile: {
      id: "3",
      username: "johndoe",
      preferred_language: "en",
    },
    size: "md",
  },
};

export const DefaultFallback: Story = {
  args: {
    size: "md",
  },
};

export const Small: Story = {
  args: {
    userProfile: {
      id: "4",
      firstName: "John",
      lastName: "Doe",
      preferred_language: "en",
    },
    size: "sm",
  },
};

export const Large: Story = {
  args: {
    userProfile: {
      id: "5",
      firstName: "John",
      lastName: "Doe",
      preferred_language: "en",
    },
    size: "lg",
  },
};
