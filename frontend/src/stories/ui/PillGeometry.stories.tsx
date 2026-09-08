import { CountBadge } from "@/components/ui/Controls/CountBadge";
import { SpinnerIcon } from "@/components/ui/Feedback/SpinnerIcon";
import {
  SettledInfoPill,
  ToolStatusPill,
} from "@/components/ui/Trace/steps/ToolStatusPill";
import {
  AssistantHubCurrentPublishedIndicator,
  getAssistantHubStatusClassName,
} from "@/pages/assistantHubUtils";

import type { Meta, StoryObj } from "@storybook/react";
import type { CSSProperties, ReactNode } from "react";

const meta = {
  title: "UI/Pill Geometry",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
Two shapes look alike at the shipped radius values and are not the same thing.

A **capsule** is a text label plus inline padding — a badge, a status chip, a filter pill. Its
corner is a design choice, so it reads the pill radius token through one class:

\`\`\`css
.pill-geometry {
  border-radius: var(--theme-radius-pill);
}
\`\`\`

A **circle** is an intrinsic square with no label — an avatar, a status dot, a spinner ring. Its
corner is not a choice: it is what makes the shape a circle at all, so it declares \`50%\`
(\`.avatar-geometry\`, \`.spinner-geometry\`) and never reads the pill token.

At stock \`radius.pill\` is \`9999px\` and the distinction is invisible. It becomes visible the moment
a theme sets \`radius.pill\` — or the legacy top-level \`borderRadius\`, which back-fills every radius
key — to something smaller: the capsules soften to that value while the circles stay round.
        `,
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every specimen is a real migrated surface, named by where it ships. */
const CAPSULES: { source: string; node: ReactNode }[] = [
  { source: "CountBadge", node: <CountBadge variant="count">12</CountBadge> },
  {
    source: "CountBadge (attention)",
    node: <CountBadge variant="attention">3</CountBadge>,
  },
  { source: "ToolStatusPill", node: <ToolStatusPill status="running" /> },
  { source: "ToolStatusPill (error)", node: <ToolStatusPill status="error" /> },
  { source: "SettledInfoPill", node: <SettledInfoPill label="Completed" /> },
  {
    source: "AssistantHubCurrentPublishedIndicator",
    node: <AssistantHubCurrentPublishedIndicator />,
  },
  {
    source: "getAssistantHubStatusClassName",
    node: (
      <span className={getAssistantHubStatusClassName("submitted")}>
        Submitted
      </span>
    ),
  },
  {
    source: "ShareGrantsList / SubjectSelector scope badge",
    node: (
      <span className="pill-geometry shrink-0 bg-theme-bg-secondary px-2 py-0.5 text-xs text-theme-fg-secondary">
        Group
      </span>
    ),
  },
];

const CIRCLES: { source: string; node: ReactNode }[] = [
  {
    source: "assistantHubUtils avatar (.avatar-geometry)",
    node: (
      <span className="avatar-geometry flex size-10 shrink-0 items-center justify-center bg-theme-bg-secondary text-sm font-semibold text-theme-fg-primary">
        AB
      </span>
    ),
  },
  {
    source: "SpinnerIcon (.spinner-geometry)",
    node: <SpinnerIcon size="lg" />,
  },
  {
    source: "status dot (rounded-full)",
    node: (
      <span className="block size-3 rounded-full bg-theme-action-primary-bg" />
    ),
  },
];

const Specimens = () => (
  <div className="flex flex-col gap-5">
    <div className="flex flex-wrap items-center gap-2">
      {CAPSULES.map(({ source, node }) => (
        <div key={source}>{node}</div>
      ))}
    </div>
    <div className="flex flex-wrap items-center gap-4">
      {CIRCLES.map(({ source, node }) => (
        <div key={source}>{node}</div>
      ))}
    </div>
  </div>
);

const Column = ({
  heading,
  caption,
  style,
}: {
  heading: string;
  caption: string;
  style?: CSSProperties;
}) => (
  <section
    className="flex min-w-72 flex-1 flex-col gap-4 border border-theme-border p-4"
    style={style}
  >
    <header className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold text-theme-fg-primary">{heading}</h3>
      <p className="text-xs text-theme-fg-muted">{caption}</p>
    </header>
    <Specimens />
  </section>
);

/**
 * The same specimens twice. The right column overrides `--theme-radius-pill`
 * on its own wrapper, which is what a theme setting `radius.pill` does to the
 * whole page.
 */
export const Dialect: Story = {
  name: "Capsules soften, circles stay round",
  render: () => (
    <div className="flex flex-wrap items-start gap-6 bg-theme-bg-primary text-theme-fg-primary">
      <Column
        heading="Stock — radius.pill: 9999px"
        caption="Capsules and circles are indistinguishable here."
      />
      <Column
        heading="Retuned — radius.pill: 0.5rem"
        caption="Capsules take the theme's corner; the circles are untouched."
        style={{ "--theme-radius-pill": "0.5rem" } as CSSProperties}
      />
    </div>
  ),
};

/** The capsule inventory on `.pill-geometry`, labelled by shipping surface. */
export const Capsules: Story = {
  render: () => (
    <ul className="flex flex-col gap-3 bg-theme-bg-primary text-theme-fg-primary">
      {CAPSULES.map(({ source, node }) => (
        <li key={source} className="flex items-center gap-3">
          <span className="w-80 shrink-0 font-mono text-xs text-theme-fg-muted">
            {source}
          </span>
          {node}
        </li>
      ))}
    </ul>
  ),
};
