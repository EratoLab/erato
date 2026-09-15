import { useState } from "react";

import { McpToolPermissionsRoster } from "@/components/ui/Settings/McpToolPermissionsRoster";
import { planDecisionChanges } from "@/components/ui/Settings/mcpToolDecisions";

import type { McpToolPermissionsRosterProps } from "@/components/ui/Settings/McpToolPermissionsRoster";
import type { McpServerTool } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";

/**
 * The settings roster of one server's tools: read-only and write/delete
 * groups, a three-state control per row and a decision menu per group.
 * The story keeps its own roster and applies each change the way the
 * backend would, so every control round-trips.
 */
const meta = {
  title: "UI/Settings/McpToolPermissionsRoster",
  component: McpToolPermissionsRoster,
  parameters: { layout: "padded" },
} satisfies Meta<typeof McpToolPermissionsRoster>;

export default meta;
type Story = StoryObj<typeof meta>;

const tool = (
  name: string,
  title: string,
  overrides: Partial<McpServerTool> & {
    readOnly?: boolean;
    annotated?: boolean;
  } = {},
): McpServerTool => {
  const { readOnly = false, annotated = true, ...rest } = overrides;
  return {
    name,
    title,
    description: `Vendor description of ${title}.`,
    description_truncated: false,
    annotations: {
      read_only_hint: readOnly,
      destructive_hint: !readOnly,
      idempotent_hint: readOnly,
      open_world_hint: false,
      annotated,
    },
    policy: readOnly ? "auto" : "ask",
    user_decision: "none",
    effective: readOnly ? "allow" : "ask",
    is_wait_tool: false,
    ...rest,
  };
};

const MIXED_ROSTER: McpServerTool[] = [
  tool("download_file_content", "Download file content", { readOnly: true }),
  tool("get_file_metadata", "Get file metadata", { readOnly: true }),
  tool("list_recent_files", "List recent files", {
    readOnly: true,
    user_decision: "ask",
    effective: "ask",
  }),
  tool("search_files", "Search files", { readOnly: true }),
  tool("copy_file", "Copy file"),
  tool("create_file", "Create file", {
    user_decision: "always_allow",
    effective: "allow",
  }),
  tool("trash_file", "Trash file", {
    user_decision: "denied",
    effective: "denied",
  }),
  tool("mystery", "mystery", { annotated: false, description: null }),
];

const RosterStory = ({
  tools: initialTools,
  availability,
}: Pick<McpToolPermissionsRosterProps, "tools" | "availability">) => {
  const [tools, setTools] = useState(initialTools);
  const [pending, setPending] = useState(false);
  return (
    <div className="w-[36rem] max-w-full">
      <McpToolPermissionsRoster
        tools={tools}
        availability={availability}
        pending={pending}
        onApply={(changes) => {
          const plan = planDecisionChanges(changes, availability);
          setPending(true);
          setTimeout(() => {
            setTools((current) =>
              current.map((tool) => plan.projected.get(tool.name) ?? tool),
            );
            setPending(false);
          }, 400);
        }}
      />
    </div>
  );
};

export const MixedGroups: Story = {
  args: {
    tools: MIXED_ROSTER,
    availability: { allowAlways: true, askAvailable: true },
    onApply: () => {},
  },
  render: (args) => <RosterStory {...args} />,
};

export const RestrictedDeployment: Story = {
  args: {
    tools: MIXED_ROSTER,
    availability: { allowAlways: false, askAvailable: false },
    onApply: () => {},
  },
  render: (args) => <RosterStory {...args} />,
};

export const Narrow: Story = {
  args: {
    tools: MIXED_ROSTER,
    availability: { allowAlways: true, askAvailable: true },
    onApply: () => {},
  },
  decorators: [
    (Story) => (
      <div className="w-80 border border-theme-border p-2">
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <div className="w-full">
      <RosterStory {...args} />
    </div>
  ),
};
