import { PlusIcon } from "@heroicons/react/24/outline";
import { expect, userEvent, within } from "@storybook/test";
import { useState } from "react";

import { Button } from "../../components/ui/Controls/Button";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Button/Tests",
  component: Button,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Accessibility and keyboard interaction tests for Button component",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="p-8 bg-theme-bg-primary">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

// Test 1: Basic keyboard interaction
export const KeyboardFocus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button");

    // Tab to focus the button
    await userEvent.tab();
    await expect(button).toHaveFocus();

    // Press space to click
    await userEvent.keyboard(" ");
    await expect(button).toHaveAttribute("data-pressed", "true");

    // Press enter to click
    await userEvent.keyboard("{Enter}");
    await expect(button).toHaveAttribute("data-pressed", "true");
  },
  render: () => <Button data-testid="test-button">Keyboard Test Button</Button>,
};

// Test 2: Icon-only button accessibility
export const IconOnlyAccessibility: Story = {
  args: {
    variant: "icon-only",
    icon: <PlusIcon />,
    "aria-label": "Add new item",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button");

    // Check for aria-label
    await expect(button).toHaveAttribute("aria-label", "Add new item");
  },
};

// Test 3: Focus trap for disabled state
export const DisabledStateInteraction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const disabledButton = canvas.getByTestId("disabled-button");
    const nextButton = canvas.getByTestId("next-button");

    // Tab through buttons
    await userEvent.tab();
    await expect(nextButton).toHaveFocus();
    await expect(disabledButton).not.toHaveFocus();
  },
  render: () => (
    <div className="flex gap-2">
      <Button disabled data-testid="disabled-button">
        Disabled Button
      </Button>
      <Button data-testid="next-button">Next Button</Button>
    </div>
  ),
};

// Test 4: Toggle button state
export const ToggleButtonInteraction: Story = {
  render: function ToggleButtonStory() {
    const [isChecked, setIsChecked] = useState(false);

    return (
      <Button
        aria-checked={isChecked}
        onClick={() => setIsChecked(!isChecked)}
        variant="secondary"
        aria-label="Toggle button"
        role="switch"
      >
        {isChecked ? "On" : "Off"}
      </Button>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("switch");

    // Initial state check
    await expect(button).toHaveAttribute("aria-checked", "false");

    // Click to toggle
    await userEvent.click(button);
    // Wait for state update
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(button).toHaveAttribute("aria-checked", "true");

    // Space key to toggle
    await userEvent.tab();
    await userEvent.keyboard(" ");
    // Wait for state update
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(button).toHaveAttribute("aria-checked", "true");
  },
};

// Test 5: Focus visible styles
export const FocusVisibleStyles: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Verify focus visible styles are applied when using keyboard navigation",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button");

    // Tab to focus
    await userEvent.tab();
    await expect(button).toHaveClass("focus-visible:ring-2");
  },
  render: () => <Button>Focus Visible Test</Button>,
};

// Test 6: List item button role
export const ListItemButtonRole: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("menuitem");

    await expect(button).toHaveAttribute("role", "menuitem");
  },
  render: () => (
    <div role="menu" className="flex flex-col">
      <Button variant="list-item">List Item Button</Button>
    </div>
  ),
};

// Test 7: Multiple button navigation
export const KeyboardNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const buttons = canvas.getAllByRole("button");

    // First tab
    await userEvent.tab();
    await expect(buttons[0]).toHaveFocus();

    // Second tab
    await userEvent.tab();
    await expect(buttons[1]).toHaveFocus();

    // Third tab
    await userEvent.tab();
    await expect(buttons[2]).toHaveFocus();
  },
  render: () => (
    <div className="flex gap-2">
      <Button>First</Button>
      <Button>Second</Button>
      <Button>Third</Button>
    </div>
  ),
};
