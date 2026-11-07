import { userEvent } from "@storybook/test";
import { useState } from "react";

import { Checkbox } from "../../components/ui/Controls/Checkbox";

import type { CheckboxProps } from "../../components/ui/Controls/Checkbox";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Checkbox",
  component: Checkbox,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
A native \`<input type="checkbox">\`. The accent comes from the base rule
(\`accent-color: var(--theme-fg-accent)\`), the keyboard ring is an outline so it
paints on native controls in WKWebView and WebView2 and under forced colors, and
\`indeterminate\` is set on the element (it has no markup). With \`label\` the
input is wrapped in \`<label data-ui="checkbox-field">\`, whose text is the
accessible name; without it, pass \`aria-label\`.

\`\`\`css
[data-ui="checkbox"] { … }        /* the input */
[data-ui="checkbox-field"] { … }  /* the label wrapper */
\`\`\`
        `,
      },
    },
  },
  args: {
    checked: false,
    onCheckedChange: () => {},
  },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

const Interactive = (props: Omit<CheckboxProps, "onCheckedChange">) => {
  const [checked, setChecked] = useState(props.checked);
  return <Checkbox {...props} checked={checked} onCheckedChange={setChecked} />;
};

const States = () => (
  <div className="flex flex-col gap-3">
    <Interactive checked={false} label="Unchecked" />
    <Interactive checked label="Checked" />
    <Interactive checked={false} indeterminate label="Indeterminate" />
    <Interactive checked={false} disabled label="Disabled" />
    <Interactive checked disabled label="Disabled, checked" />
    <div className="flex items-center gap-2 text-sm text-theme-fg-secondary">
      <Interactive checked={false} aria-label="Without a visible label" />
      <span aria-hidden="true">(named by aria-label)</span>
    </div>
  </div>
);

export const AllStates: Story = {
  render: () => <States />,
};

export const Dark: Story = {
  render: () => <States />,
  globals: { theme: "dark" },
};

export const FocusVisible: Story = {
  render: () => (
    <div className="flex gap-6">
      <Interactive checked={false} label="Select all" />
      <Interactive checked={false} label="Only selected" />
    </div>
  ),
  play: async () => {
    await userEvent.tab();
  },
};
