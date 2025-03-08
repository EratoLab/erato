import { expect, within, userEvent } from "@storybook/test";

import { Default, WithDisabledItem } from "./DropdownMenu.stories";
import { DropdownMenu } from "../../components/ui/Controls/DropdownMenu";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/DropdownMenu/Tests",
  component: DropdownMenu,
  parameters: {
    layout: "centered",
    a11y: {
      config: {
        rules: [
          {
            id: "aria-roles",
            enabled: true,
          },
        ],
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ minHeight: "400px", paddingTop: "100px" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AccessibilityTest: Story = {
  args: {
    ...Default.args,
    items: Default.args.items,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Check ARIA attributes
    const menuButton = canvas.getByRole("button", { name: /open menu/i });
    await expect(menuButton).toHaveAttribute("aria-haspopup", "true");
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");

    // Open menu
    await userEvent.click(menuButton);
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");

    // Check menu items
    const menu = canvas.getByRole("menu");
    await expect(menu).toBeInTheDocument();
    const menuItems = canvas.getAllByRole("menuitem");
    await expect(menuItems).toHaveLength(2);
  },
};

export const InteractionTest: Story = {
  args: {
    ...Default.args,
    items: Default.args.items,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    // Test opening menu
    const menuButton = canvas.getByRole("button", { name: /open menu/i });
    await user.click(menuButton);
    await expect(canvas.getByRole("menu")).toBeInTheDocument();

    // Test clicking menu item
    const editButton = canvas.getByRole("menuitem", { name: /edit/i });
    await user.click(editButton);
    await expect(canvas.queryByRole("menu")).not.toBeInTheDocument();

    // Test clicking outside
    await user.click(menuButton);
    await user.click(document.body);
    await expect(canvas.queryByRole("menu")).not.toBeInTheDocument();
  },
};

export const DisabledItemTest: Story = {
  args: {
    ...WithDisabledItem.args,
    items: WithDisabledItem.args.items,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    // Open menu
    const menuButton = canvas.getByRole("button", { name: /open menu/i });
    await user.click(menuButton);

    // Check disabled item
    const deleteButton = canvas.getByRole("menuitem", { name: /delete/i });
    await expect(deleteButton).toBeDisabled();

    // Check enabled item
    const editButton = canvas.getByRole("menuitem", { name: /edit/i });
    await expect(editButton).not.toBeDisabled();
  },
};

export const KeyboardNavigationTest: Story = {
  args: {
    ...Default.args,
    items: Default.args.items,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    // Focus the menu button
    await user.tab();
    const menuButton = canvas.getByRole("button", { name: /open menu/i });
    await expect(menuButton).toHaveFocus();

    // Open menu with Enter
    await user.keyboard("{Enter}");
    await expect(canvas.getByRole("menu")).toBeInTheDocument();

    // First item should be automatically focused
    const firstItem = canvas.getByRole("menuitem", { name: /edit/i });
    await expect(firstItem).toHaveFocus();

    // Tab to second item
    await user.keyboard("{Tab}");
    const secondItem = canvas.getByRole("menuitem", { name: /delete/i });
    await expect(secondItem).toHaveFocus();

    // Tab again should cycle back to first item
    await user.keyboard("{Tab}");
    await expect(firstItem).toHaveFocus();

    // Shift+Tab should go to last item
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    await expect(secondItem).toHaveFocus();

    // Close with Escape
    await user.keyboard("{Escape}");
    await expect(canvas.queryByRole("menu")).not.toBeInTheDocument();
    await expect(menuButton).toHaveFocus(); // Focus should return to trigger button
  },
};
