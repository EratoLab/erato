import { SpinnerIcon } from "../../components/ui/Feedback/SpinnerIcon";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/SpinnerIcon",
  component: SpinnerIcon,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
The loading ring. Every spinner the host and the Office add-in draw is this component — and so are a
component kit's, once the kit adopts it — and every one of them is reachable from a customer theme
through one selector:

\`\`\`css
[data-ui="spinner"] {
  --spinner-track: var(--theme-border-strong);
  --spinner-head: var(--theme-fg-accent);
  --spinner-thickness: 3px;
  --spinner-duration: 1.4s;
}
\`\`\`

The head defaults to \`--theme-fg-secondary\` and the track to a 25% dilution of it, so the ink is a
complete circle that stays centred while it turns. Set \`--spinner-head\` alone and the track follows
it; both fade together on a disabled control, where a track pinned to its own colour would wash out
and leave a lone arc.

The ring is a circle by intrinsic shape, so it reads no radius token — retuning \`radius.pill\`,
\`radius.card\` or \`radius.shell\` cannot deform it.

## Accessibility
- By default the ring is a \`role="status"\` region carrying screen-reader-only text.
- \`label\` renders a visible caption which supplies the announced text instead.
- \`aria-hidden\` marks the ring decorative and drops \`role="status"\`, for sites where the
  surrounding element already carries the live region.
        `,
      },
    },
  },
  argTypes: {
    size: {
      control: "radio",
      options: ["sm", "md", "lg", "xl", "fill"],
      description: "Ring diameter: 12 / 16 / 24 / 32px, or fill the parent",
    },
    label: { control: "text", description: "Visible caption under the ring" },
    srText: {
      control: "text",
      description: "Announced text when there is no visible caption",
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof SpinnerIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { size: "md" },
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-6">
      {(["sm", "md", "lg", "xl"] as const).map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <SpinnerIcon size={size} />
          <span className="text-xs text-theme-fg-muted">{size}</span>
        </div>
      ))}
      <div className="flex flex-col items-center gap-2">
        <div className="size-12">
          <SpinnerIcon size="fill" />
        </div>
        <span className="text-xs text-theme-fg-muted">fill (48px box)</span>
      </div>
    </div>
  ),
};

export const Labelled: Story = {
  args: { size: "xl", label: "Loading assistant..." },
};

export const Decorative: Story = {
  render: () => (
    <div
      className="flex items-center gap-2 text-sm text-theme-fg-secondary"
      role="status"
      aria-label="Expanding email"
    >
      <SpinnerIcon size="sm" aria-hidden />
      <span>Expanding email…</span>
    </div>
  ),
};

export const CustomHead: Story = {
  name: "Custom head",
  args: {
    size: "lg",
    style: {
      "--spinner-head": "var(--theme-fg-accent)",
    } as React.CSSProperties,
  },
};

/**
 * One rule reaches every spinner on the page — the bare rings, the ring inside
 * the labelled block, and the decorative one — because the members read the
 * private vars and never declare them.
 */
export const Retuned: Story = {
  render: () => (
    <div className="flex flex-col items-center gap-8">
      <style>{`
        [data-ui="spinner"] {
          --spinner-track: color-mix(in srgb, var(--theme-fg-accent) 25%, transparent);
          --spinner-head: var(--theme-fg-accent);
          --spinner-thickness: 3px;
          --spinner-duration: 1.4s;
        }
      `}</style>
      <div className="flex items-end gap-6">
        {(["sm", "md", "lg", "xl"] as const).map((size) => (
          <SpinnerIcon key={size} size={size} />
        ))}
      </div>
      <SpinnerIcon size="xl" label="Loading assistant..." />
      <div className="flex items-center gap-2 text-sm text-theme-fg-secondary">
        <SpinnerIcon size="sm" aria-hidden />
        <span>Expanding email…</span>
      </div>
    </div>
  ),
};
