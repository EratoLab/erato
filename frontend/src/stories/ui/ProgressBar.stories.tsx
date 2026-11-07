import { ProgressBar } from "../../components/ui/Feedback/ProgressBar";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/ProgressBar",
  component: ProgressBar,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
A determinate progress bar with no text of its own: the caller names it
(\`label\`) and may say the value in words (\`valueText\`). The width transition
stops under reduced motion; under forced colors the track gets an outline and
the fill paints in \`Highlight\`.

\`\`\`css
[data-ui="progress"] { --progress-track: …; --progress-fill: …; }
.progress-geometry { … }   /* height and corner */
\`\`\`
        `,
      },
    },
  },
  args: {
    value: 50,
    label: "Progress",
  },
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

const Matrix = () => (
  <div className="flex w-64 flex-col gap-4 text-sm text-theme-fg-secondary">
    {[0, 50, 100].map((value) => (
      <div key={value} className="flex flex-col gap-1">
        <span>{value} %</span>
        <ProgressBar value={value} label={`${value} percent`} />
      </div>
    ))}
    <div className="flex flex-col gap-1">
      <span>1 of 2, small (policy check)</span>
      <ProgressBar
        value={1}
        max={2}
        size="sm"
        label="Policy check"
        valueText="1 of 2 items checked"
      />
    </div>
    <div className="flex flex-col gap-1">
      <span>Warning</span>
      <ProgressBar value={70} tone="warning" label="Warning" />
    </div>
  </div>
);

export const Default: Story = {
  render: (args) => (
    <div className="w-64">
      <ProgressBar {...args} />
    </div>
  ),
};

export const AllStates: Story = {
  render: () => <Matrix />,
};

export const Dark: Story = {
  render: () => <Matrix />,
  globals: { theme: "dark" },
};
