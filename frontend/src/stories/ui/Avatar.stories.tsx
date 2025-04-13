import { Avatar } from "../../components/ui/Feedback/Avatar";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";

// Helper function to create test profiles that bypass type restrictions
const createTestProfile = (
  props: Record<string, string | boolean | number>,
): UserProfile => {
  return props as unknown as UserProfile;
};

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
    userProfile: createTestProfile({
      id: "1",
      username: "johndoe",
      firstName: "John",
      lastName: "Doe",
      avatarUrl: "https://i.pravatar.cc/300",
      preferred_language: "en",
    }),
    size: "md",
  },
};

export const WithNameInitials: Story = {
  args: {
    userProfile: createTestProfile({
      id: "2",
      username: "johndoe",
      firstName: "John",
      lastName: "Doe",
      preferred_language: "en",
    }),
    size: "md",
  },
};

export const WithUsername: Story = {
  args: {
    userProfile: createTestProfile({
      id: "3",
      username: "johndoe",
      preferred_language: "en",
    }),
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
    userProfile: createTestProfile({
      id: "4",
      firstName: "John",
      lastName: "Doe",
      preferred_language: "en",
    }),
    size: "sm",
  },
};

export const Large: Story = {
  args: {
    userProfile: createTestProfile({
      id: "5",
      name: "John Doe",
      preferred_language: "en",
    }),
    size: "lg",
  },
};
