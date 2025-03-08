import { expect, within } from "@storybook/test";

import { Avatar } from "../../components/ui/Feedback/Avatar";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Avatar/Tests",
  component: Avatar,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="bg-theme-bg-primary p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TestFallbackMechanics: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Test default fallback
    const defaultAvatar = canvas.getByText("E");
    await expect(defaultAvatar).toBeInTheDocument();
  },
};

export const TestUsernameInitial: Story = {
  args: {
    userProfile: {
      id: "1",
      username: "johndoe",
      preferred_language: "en",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const initial = canvas.getByText("J");
    await expect(initial).toBeInTheDocument();
  },
};

export const TestNameInitials: Story = {
  args: {
    userProfile: {
      id: "2",
      username: "johndoe",
      firstName: "John",
      lastName: "Doe",
      preferred_language: "en",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const initials = canvas.getByText("JD");
    await expect(initials).toBeInTheDocument();
  },
};

export const TestImageAvatar: Story = {
  args: {
    userProfile: {
      id: "3",
      username: "johndoe",
      firstName: "John",
      lastName: "Doe",
      avatarUrl: "https://i.pravatar.cc/300",
      preferred_language: "en",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const image = canvas.getByRole("img");
    await expect(image).toBeInTheDocument();
    await expect(image).toHaveAttribute("alt", "User avatar");
    await expect(image).toHaveAttribute("src");
  },
};

export const TestSizeVariants: Story = {
  args: {
    userProfile: {
      id: "4",
      firstName: "John",
      lastName: "Doe",
      preferred_language: "en",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const avatar = canvas.getByText("JD");
    const container = avatar.parentElement;

    await expect(container).toHaveClass("w-10", "h-10"); // Default md size
  },
};
