import type { Meta, StoryObj } from "@storybook/react";
import { Avatar } from "../../components/ui/Avatar";

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
      username: "johndoe",
      firstName: "John",
      lastName: "Doe",
      avatarUrl: "https://i.pravatar.cc/300",
    },
    size: "md",
  },
};

export const WithNameInitials: Story = {
  args: {
    userProfile: {
      username: "johndoe",
      firstName: "John",
      lastName: "Doe",
    },
    size: "md",
  },
};

export const WithUsername: Story = {
  args: {
    userProfile: {
      username: "johndoe",
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
      firstName: "John",
      lastName: "Doe",
    },
    size: "sm",
  },
};

export const Large: Story = {
  args: {
    userProfile: {
      firstName: "John",
      lastName: "Doe",
    },
    size: "lg",
  },
};
