import { MessageContent } from "../../components/ui/Message/MessageContent";

import type { Meta, StoryObj } from "@storybook/react";

const shortCode = ["const a = 1;", "const b = 2;", "console.log(a + b);"].join(
  "\n",
);

const longCode = Array.from(
  { length: 120 },
  (_, index) =>
    `const line${index} = compute(${index}); // a reasonably long line of code`,
).join("\n");

const meta = {
  title: "UI/MessageContent/CodeBlock",
  component: MessageContent,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="bg-theme-bg-primary p-6">
        <div className="mx-auto max-w-[46rem]">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof MessageContent>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Short enough to need no affordance at all. */
export const ShortCode: Story = {
  args: {
    content: [{ content_type: "text", text: "```ts\n" + shortCode + "\n```" }],
  },
};

/** Clamps at the themed height and says how much it is hiding. */
export const LongCodeClamped: Story = {
  args: {
    content: [{ content_type: "text", text: "```ts\n" + longCode + "\n```" }],
  },
};
