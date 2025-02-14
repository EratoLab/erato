import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { Avatar } from "../../components/ui/Avatar";

const meta = {
  title: "UI/Avatar/Tests",
  component: Avatar,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="p-8 bg-theme-bg-primary">
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
    const defaultAvatar = canvas.getByText('E');
    await expect(defaultAvatar).toBeInTheDocument();
  },
};

export const TestUsernameInitial: Story = {
  args: {
    userProfile: {
      username: "johndoe",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const initial = canvas.getByText('J');
    await expect(initial).toBeInTheDocument();
  },
};

export const TestNameInitials: Story = {
  args: {
    userProfile: {
      username: "johndoe",
      firstName: "John",
      lastName: "Doe",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const initials = canvas.getByText('JD');
    await expect(initials).toBeInTheDocument();
  },
};

export const TestImageAvatar: Story = {
  args: {
    userProfile: {
      username: "johndoe",
      firstName: "John",
      lastName: "Doe",
      avatarUrl: "https://i.pravatar.cc/300",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const image = canvas.getByRole('img');
    await expect(image).toBeInTheDocument();
    await expect(image).toHaveAttribute('alt', 'User avatar');
    await expect(image).toHaveAttribute('src');
  },
};

export const TestSizeVariants: Story = {
  args: {
    userProfile: {
      firstName: "John",
      lastName: "Doe",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const avatar = canvas.getByText('JD');
    const container = avatar.parentElement;
    
    await expect(container).toHaveClass('w-10', 'h-10'); // Default md size
  },
}; 