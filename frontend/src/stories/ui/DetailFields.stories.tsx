import { DetailFields } from "../../components/ui/Container/DetailFields";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/DetailFields",
  component: DetailFields,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
Label/value pairs as a \`<dl>\`. In the \`grid\` layout the label column is as
wide as the widest label, so a longer translation is never clipped; values wrap
anywhere, so a long address stays inside its column.
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
  args: { fields: [] },
} satisfies Meta<typeof DetailFields>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Email: Story = {
  args: {
    fields: [
      { label: "Von", value: "Max Goisser <max@eratolabs.com>" },
      { label: "An", value: "Jane Windows <windows1@ms.eratolabs.com>" },
      { label: "Datum", value: "16.09.2026, 14:19" },
      { label: "Postfach", value: "windows1@ms.eratolabs.com" },
    ],
  },
};

export const Attachment: Story = {
  args: {
    fields: [
      { label: "Anhang von", value: "Test with attachment" },
      { label: "Absender", value: "Max Goisser <max@eratolabs.com>" },
      { label: "Datum", value: "16.09.2026, 14:19" },
      { label: "Typ", value: "PDF · 34 KB" },
    ],
  },
};

export const Folder: Story = {
  args: {
    fields: [
      { label: "Pfad", value: "Posteingang / Projekte / 2026" },
      { label: "Elemente", value: "128" },
    ],
  },
};

export const LongAddresses: Story = {
  args: {
    fields: [
      { label: "From", value: "Max Goisser <max@eratolabs.com>" },
      {
        label: "To",
        value:
          "Jane Windows <windows1@ms.eratolabs.com>, a-very-long-distribution-list-name-without-breaks@subsidiary.example.com, Anna Schmidt <anna.schmidt@example.com>",
      },
      { label: "Cc", value: "team@example.com" },
    ],
  },
};

export const StackedExtraSmall: Story = {
  args: {
    layout: "stacked",
    size: "xs",
    labelTone: "secondary",
    fields: [
      { label: "From", value: "Max Goisser <max@eratolabs.com>" },
      { label: "Date", value: "16.09.2026, 14:19" },
    ],
  },
};

export const Dark: Story = {
  args: Email.args,
  globals: { theme: "dark" },
};
