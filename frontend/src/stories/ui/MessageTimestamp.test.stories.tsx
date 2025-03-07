import { expect, within } from "@storybook/test";

import { MessageTimestamp } from "../../components/ui/Message/MessageTimestamp";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/MessageTimestamp/Tests",
  component: MessageTimestamp,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof MessageTimestamp>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultBehaviorTest: Story = {
  args: {
    createdAt: new Date(),
    displayStyle: "relative",
    autoUpdate: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const timeElement = canvas.getByRole("time");
    await expect(timeElement).toBeInTheDocument();
    await expect(timeElement.textContent).toMatch(/less than 5 seconds ago/i);
  },
};

export const ExactTimeTest: Story = {
  args: {
    createdAt: new Date("2024-03-20T15:30:00"),
    displayStyle: "time",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const timeElement = canvas.getByRole("time");
    await expect(timeElement.textContent).toBe("15:30");
  },
};

export const TitleAttributeTest: Story = {
  args: {
    createdAt: new Date("2024-03-20T15:30:00"),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const timeElement = canvas.getByRole("time");
    await expect(timeElement.title).toBe(
      new Date("2024-03-20T15:30:00").toLocaleString(),
    );
  },
};

export const AutoUpdateTest: Story = {
  args: {
    createdAt: new Date(),
    autoUpdate: true,
  },
  render: (args) => {
    const now = new Date();
    return <MessageTimestamp {...args} createdAt={now} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const timeElement = canvas.getByRole("time");

    await expect(timeElement.textContent).toMatch(/less than 5 seconds ago/i);

    await new Promise((resolve) => setTimeout(resolve, 5000));
    await expect(timeElement.textContent).toMatch(/less than 10 seconds ago/i);
  },
};

export const NoAutoUpdateTest: Story = {
  args: {
    createdAt: new Date(),
    autoUpdate: false,
  },
  render: (args) => {
    const now = new Date();
    return <MessageTimestamp {...args} createdAt={now} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const timeElement = canvas.getByRole("time");

    await expect(timeElement.textContent).toMatch(/less than 5 seconds ago/i);

    await new Promise((resolve) => setTimeout(resolve, 5000));
    await expect(timeElement.textContent).toMatch(/less than 5 seconds ago/i);
  },
};
