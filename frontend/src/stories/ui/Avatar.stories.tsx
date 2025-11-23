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
Avatar component that displays user and assistant profile images with intelligent fallbacks:

**User Avatars (userOrAssistant=true):**
- Uses avatar URL if provided
- Falls back to initials from first and last name if available
- Falls back to first letter of username if available
- Defaults to 'E' for Erato if no user data is present

**Assistant Avatars (userOrAssistant=false):**
- Loads custom avatar from theme configuration if available
- Falls back to 'A' initial with themed colors if no custom avatar

## Features
- Browser-native image loading with HTTP caching
- Responsive sizing (sm, md, lg)
- Memoized to prevent unnecessary re-renders
- Maintains consistent dimensions to prevent CLS
- Graceful error handling with onError fallback
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
      description:
        "User profile data for avatar display (used for user avatars)",
    },
    userOrAssistant: {
      control: "boolean",
      description:
        "Whether this is a user avatar (true) or assistant avatar (false). When false, loads custom assistant avatar from theme if available.",
      table: {
        defaultValue: { summary: "undefined" },
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithImage: Story = {
  name: "User (With Image)",
  args: {
    userProfile: createTestProfile({
      id: "1",
      username: "johndoe",
      firstName: "John",
      lastName: "Doe",
      avatarUrl: "https://i.pravatar.cc/300",
      preferred_language: "en",
    }),
    userOrAssistant: true,
    size: "md",
  },
};

export const WithNameInitials: Story = {
  name: "User (Name Initials)",
  args: {
    userProfile: createTestProfile({
      id: "2",
      username: "johndoe",
      firstName: "John",
      lastName: "Doe",
      preferred_language: "en",
    }),
    userOrAssistant: true,
    size: "md",
  },
};

export const WithUsername: Story = {
  name: "User (Username)",
  args: {
    userProfile: createTestProfile({
      id: "3",
      username: "johndoe",
      preferred_language: "en",
    }),
    userOrAssistant: true,
    size: "md",
  },
};

export const DefaultFallback: Story = {
  name: "User (Default Fallback)",
  args: {
    userOrAssistant: true,
    size: "md",
  },
};

export const Small: Story = {
  name: "User (Small)",
  args: {
    userProfile: createTestProfile({
      id: "4",
      firstName: "John",
      lastName: "Doe",
      preferred_language: "en",
    }),
    userOrAssistant: true,
    size: "sm",
  },
};

export const Large: Story = {
  name: "User (Large)",
  args: {
    userProfile: createTestProfile({
      id: "5",
      name: "John Doe",
      preferred_language: "en",
    }),
    userOrAssistant: true,
    size: "lg",
  },
};

// Assistant Avatar Stories
export const AssistantDefault: Story = {
  name: "Assistant (Default Fallback)",
  args: {
    userOrAssistant: false,
    size: "md",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Assistant avatar with no custom image configured. Shows the 'A' initial with themed colors.",
      },
    },
  },
};

export const AssistantWithCustomImage: Story = {
  name: "Assistant (With Custom Image)",
  args: {
    userOrAssistant: false,
    size: "md",
  },
  parameters: {
    docs: {
      description: {
        story: `
Assistant avatar with custom image from theme.
To see this in action, configure a custom assistant avatar:
1. Set VITE_CUSTOMER_NAME environment variable (e.g., "my-company")
2. Place assistant-avatar.svg in public/custom-theme/my-company/
3. Or set VITE_ASSISTANT_AVATAR_PATH to point to your avatar image
        `,
      },
    },
  },
};

export const AssistantSmall: Story = {
  name: "Assistant (Small)",
  args: {
    userOrAssistant: false,
    size: "sm",
  },
};

export const AssistantLarge: Story = {
  name: "Assistant (Large)",
  args: {
    userOrAssistant: false,
    size: "lg",
  },
};
