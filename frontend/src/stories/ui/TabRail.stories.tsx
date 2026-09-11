/**
 * TabRail Component Stories
 *
 * The one tab strip behind the settings rails, the markdown/preview switch and
 * every segmented control. Both anatomy variants, both orientations, and the
 * one-rule retune a customer theme applies through the `tab-rail` hook.
 */
import { Group, List, Settings, User } from "iconoir-react";
import { useState } from "react";

import { TabRail } from "@/components/ui/Controls/TabRail";

import type {
  TabRailOption,
  TabRailProps,
} from "@/components/ui/Controls/TabRail";
import type { Meta, StoryObj } from "@storybook/react";

// Use string type for stories
type StringRailProps = TabRailProps<string>;

const viewOptions: TabRailOption<string>[] = [
  { value: "chats", label: "Chats" },
  { value: "runs", label: "Delegated runs" },
  { value: "shared", label: "Shared with me" },
];

const settingsOptions: TabRailOption<string>[] = [
  { value: "personalization", label: "Personalization", icon: <User /> },
  { value: "appearance", label: "Appearance", icon: <Settings /> },
  { value: "audio", label: "Audio input", icon: <List /> },
  { value: "data", label: "Data", icon: <Group /> },
];

const meta = {
  title: "UI/Controls/TabRail",
  component: TabRail,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
One controlled tab strip for every tab-shaped surface.

**Variants:**
- \`rail\` — a bare strip of tabs (the settings rails, the markdown/preview switch)
- \`segmented\` — the bordered inset track of \`SegmentedControl\`

**Features:**
- ARIA tablist/tab roles, \`aria-orientation\` on every variant
- Roving tab stop that steps over disabled options, automatic activation
- \`arrowKeys\` chooses which arrow pairs walk the strip; Home/End always do
- Per-option icon, attention dot, \`panelId\` and caller-supplied tab \`id\`
- Layout direction stays the caller's: pass \`flex-col\` or \`md:flex-col\` through \`className\`

**Retune:** every rail carries \`data-ui="tab-rail"\` and every tab
\`data-ui="tab-rail-tab"\`; one rule setting \`--tab-rail-radius\` on the hook
reshapes them all.
        `,
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["rail", "segmented"],
      description: "Anatomy",
    },
    orientation: {
      control: "select",
      options: ["horizontal", "vertical"],
      description: "Announced orientation",
    },
    arrowKeys: {
      control: "select",
      options: ["horizontal", "vertical", "both"],
      description:
        "Arrow pairs that walk the strip (defaults to the orientation)",
    },
    disabled: {
      control: "boolean",
      description: "Disable the whole strip",
    },
  },
  args: {
    options: viewOptions,
    value: "chats",
    onChange: () => {},
    "aria-label": "View",
  },
  decorators: [
    (Story) => (
      <div className="bg-theme-bg-primary p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TabRail<string>>;

export default meta;
type Story = StoryObj<typeof meta>;

// Wrapper to handle state
function TabRailStory(args: StringRailProps) {
  const [value, setValue] = useState(args.value);

  return <TabRail {...args} value={value} onChange={setValue} />;
}

/**
 * The bare rail, horizontal: the markdown/preview switch's anatomy.
 */
export const Rail: Story = {
  render: (args) => <TabRailStory {...args} />,
  args: { variant: "rail" },
};

/**
 * A vertical rail. The orientation is announced; the stacking is the
 * caller's `flex-col`.
 */
export const RailVertical: Story = {
  render: (args) => <TabRailStory {...args} />,
  args: {
    variant: "rail",
    orientation: "vertical",
    className: "flex-col",
    tabClassName: "text-left w-full",
    options: settingsOptions,
    value: "appearance",
    "aria-label": "Preferences",
  },
};

/**
 * The segmented track, horizontal: what `SegmentedControl` renders.
 */
export const Segmented: Story = {
  render: (args) => <TabRailStory {...args} />,
  args: {
    variant: "segmented",
    tabClassName: "px-3 py-1.5 text-sm",
  },
};

/**
 * A vertical segmented track.
 */
export const SegmentedVertical: Story = {
  render: (args) => <TabRailStory {...args} />,
  args: {
    variant: "segmented",
    orientation: "vertical",
    className: "flex-col",
    tabClassName: "px-3 py-1.5 text-sm",
  },
};

/**
 * Icons on both variants. The wrapper is aria-hidden either way; the
 * segmented one is sized to the segment's text.
 */
export const WithIcons: Story = {
  render: (args) => (
    <div className="flex flex-col items-start gap-6">
      <TabRailStory {...args} variant="rail" />
      <TabRailStory
        {...args}
        variant="segmented"
        tabClassName="px-3 py-1.5 text-sm"
      />
    </div>
  ),
  args: {
    options: [
      { value: "users", label: "Users", icon: <User className="size-4" /> },
      { value: "groups", label: "Groups", icon: <Group className="size-4" /> },
    ],
    value: "users",
    "aria-label": "Filter by type",
  },
};

/**
 * The attention dot, read out after the label. AssistantWelcomeScreen uses it
 * for a delegated run waiting on the user.
 */
export const WithAttention: Story = {
  render: (args) => (
    <div className="flex flex-col items-start gap-6">
      <TabRailStory {...args} variant="rail" />
      <TabRailStory
        {...args}
        variant="segmented"
        tabClassName="px-3 py-1.5 text-sm"
      />
    </div>
  ),
  args: {
    options: [
      { value: "chats", label: "Chats" },
      {
        value: "runs",
        label: "Delegated runs",
        attention: {
          label: "Action required",
          toneClassName: "text-theme-warning-fg",
          pulse: true,
        },
      },
    ],
    value: "chats",
  },
};

/**
 * One option disabled: the keys step over it, the click ignores it. The rail
 * dims the tab; the segmented variant only changes its cursor.
 */
export const OptionDisabled: Story = {
  render: (args) => (
    <div className="flex flex-col items-start gap-6">
      <TabRailStory {...args} variant="rail" />
      <TabRailStory
        {...args}
        variant="segmented"
        tabClassName="px-3 py-1.5 text-sm"
      />
    </div>
  ),
  args: {
    options: [
      { value: "chats", label: "Chats" },
      { value: "runs", label: "Delegated runs", disabled: true },
      { value: "shared", label: "Shared with me" },
    ],
  },
};

/**
 * The whole strip disabled. The segmented variant dims its track; the rail
 * dims each tab — the two placements the surfaces had before they moved here.
 */
export const StripDisabled: Story = {
  render: (args) => (
    <div className="flex flex-col items-start gap-6">
      <TabRailStory {...args} variant="rail" />
      <TabRailStory
        {...args}
        variant="segmented"
        tabClassName="px-3 py-1.5 text-sm"
      />
    </div>
  ),
  args: { disabled: true },
};

/**
 * The preferences rail's shape: announced vertical, stacked from `md` up and
 * a scrolling row below it, so both arrow pairs walk it. Resize the viewport
 * to see the direction change.
 */
export const ResponsiveRail: Story = {
  render: (args) => (
    <div className="w-[36rem] max-w-full">
      <TabRailStory {...args} />
    </div>
  ),
  args: {
    variant: "rail",
    orientation: "vertical",
    arrowKeys: "both",
    className: "overflow-x-auto md:flex-col md:overflow-x-visible",
    tabClassName: "text-left md:w-full",
    options: settingsOptions,
    value: "appearance",
    "aria-label": "Preferences",
  },
};

function RetuneSamples(args: StringRailProps) {
  return (
    <div className="flex flex-col items-start gap-4">
      <TabRailStory {...args} variant="rail" />
      <TabRailStory
        {...args}
        variant="segmented"
        tabClassName="px-3 py-1.5 text-sm"
      />
      <TabRailStory
        {...args}
        variant="rail"
        orientation="vertical"
        className="flex-col"
        tabClassName="text-left w-full"
        options={settingsOptions}
        value="appearance"
        aria-label="Preferences"
      />
    </div>
  );
}

/**
 * The same rails twice: stock, and under one rule on the family hook, written
 * the way a customer theme writes it (a descendant selector, so it outranks
 * the geometry class on specificity as well as on layer). `--tab-rail-radius`
 * pills every tab; zeroing the track inset and border turns the segmented
 * track into a bare row of pills. Note the `0px`: a unitless `0` inside the
 * corner's `max()` is invalid and would square every tab instead.
 */
export const Retuned: Story = {
  render: (args) => (
    <div className="flex flex-col gap-10">
      <style>{`
        [data-retune] [data-ui="tab-rail"] {
          --tab-rail-radius: var(--theme-radius-pill);
          --tab-rail-track-padding: 0px;
          --tab-rail-track-border-width: 0px;
        }
      `}</style>
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-theme-fg-secondary">Stock</h3>
        <RetuneSamples {...args} />
      </section>
      <section className="flex flex-col gap-3" data-retune="">
        <h3 className="text-sm font-medium text-theme-fg-secondary">
          Retuned through the hook
        </h3>
        <RetuneSamples {...args} />
      </section>
    </div>
  ),
};
