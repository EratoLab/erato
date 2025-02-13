import type { Meta, StoryObj } from "@storybook/react";
import { DropdownMenu } from "../../components/ui/DropdownMenu";
import { EditIcon, Trash } from "../../components/ui/icons";
import { defaultTheme } from "../../config/theme";
import { within, userEvent } from "@storybook/test";

const meta = {
  title: "UI/DropdownMenu",
  component: DropdownMenu,
  parameters: {
    layout: "centered",
    chromatic: { delay: 300 },
  },
  decorators: [
    (Story) => (
      <div 
        style={{ minHeight: "400px", paddingTop: "100px" }}
        className="bg-theme-bg-primary"
        data-theme={defaultTheme}
      >
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    items: [
      {
        label: "Edit",
        icon: <EditIcon className="w-4 h-4" />,
        onClick: () => console.log("Edit clicked"),
      },
      {
        label: "Delete",
        icon: <Trash className="w-4 h-4" />,
        onClick: () => console.log("Delete clicked"),
        variant: "danger",
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: /open menu/i });
    await userEvent.click(button);
  },
};

export const LeftAligned: Story = {
  args: {
    ...Default.args,
    align: "left",
  },
};

export const WithDisabledItem: Story = {
  args: {
    items: [
      {
        label: "Edit",
        icon: <EditIcon className="w-4 h-4" />,
        onClick: () => console.log("Edit clicked"),
      },
      {
        label: "Delete",
        icon: <Trash className="w-4 h-4" />,
        onClick: () => console.log("Delete clicked"),
        disabled: true,
        variant: "danger",
      },
    ],
  },
}; 