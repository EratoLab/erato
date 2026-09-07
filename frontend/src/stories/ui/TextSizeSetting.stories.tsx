import { TextSizeSetting } from "@/components/ui/Settings/TextSizeSetting";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Settings/TextSizeSetting",
  component: TextSizeSetting,
  tags: ["autodocs"],
} satisfies Meta<typeof TextSizeSetting>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="max-w-xl p-6">
      <TextSizeSetting />
    </div>
  ),
};

export const NarrowPane: Story = {
  render: () => (
    <div className="w-72 p-4">
      <TextSizeSetting />
    </div>
  ),
};
