import { useState } from "react";

import { McpToolRow } from "@/components/ui/Settings/McpToolRow";

import type { McpServerTool } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";

/**
 * One MCP tool row as the settings roster and the tool browser show it.
 * Vendor text (title, wire name, description) is rendered as inert text;
 * the description hides behind the chevron because vendors write whole
 * tutorials into it.
 */
const meta = {
  title: "UI/Settings/McpToolRow",
  component: McpToolRow,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[36rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof McpToolRow>;

export default meta;
type Story = StoryObj<typeof meta>;

const baseTool: McpServerTool = {
  name: "get_issue",
  title: "Get issue",
  description: "Fetches one issue by its identifier, with comments.",
  description_truncated: false,
  annotations: {
    read_only_hint: true,
    destructive_hint: false,
    idempotent_hint: true,
    open_world_hint: false,
    annotated: true,
  },
  policy: "auto",
  user_decision: "none",
  effective: "allow",
  is_wait_tool: false,
};

// Everything a vendor could throw at the row: markup that must stay
// literal, a right-to-left override that must not reorder the roster, an
// unbroken token wider than the row, blank-line runs, and the cut mark.
const PATHOLOGICAL_DESCRIPTION = [
  "<b>Upload</b> a file and attach it to an issue. See [the docs](https://example.invalid) or <script>alert(1)</script>.",
  "",
  "Step 1 \u202Etxt.exe\u202C is the file. Set the path first:",
  "",
  "  $env:ERATO_UPLOAD = 'C:\\Users\\me\\Documents\\attachments'",
  "  Get-ChildItem $env:ERATO_UPLOAD | ForEach-Object { Invoke-Upload $_ }",
  "",
  "A".repeat(300),
  "",
  "Then repeat for every attachment. ".repeat(40).trim(),
].join("\n");

export const Collapsed: Story = {
  args: { tool: baseTool },
};

export const PathologicalDescription: Story = {
  args: {
    tool: {
      ...baseTool,
      name: "create_attachment",
      title:
        "Create attachment (uploads a file to the issue tracker of your team)",
      description: PATHOLOGICAL_DESCRIPTION,
      description_truncated: true,
      annotations: {
        read_only_hint: false,
        destructive_hint: false,
        idempotent_hint: false,
        open_world_hint: true,
        annotated: true,
      },
      policy: "ask",
      effective: "ask",
    },
  },
};

export const WithoutDescription: Story = {
  args: {
    tool: {
      ...baseTool,
      name: "mystery",
      title: "mystery",
      description: null,
      annotations: {
        read_only_hint: false,
        destructive_hint: true,
        idempotent_hint: false,
        open_world_hint: true,
        annotated: false,
      },
    },
  },
};

const PerChatSwitch = () => {
  const [isOn, setIsOn] = useState(true);
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-theme-fg-secondary">
      <input
        type="checkbox"
        checked={isOn}
        onChange={() => setIsOn((value) => !value)}
        className="size-4 accent-[var(--theme-fg-accent)]"
      />
      <span>In this chat</span>
    </label>
  );
};

export const WithControl: Story = {
  args: {
    tool: baseTool,
    control: <PerChatSwitch />,
  },
};

export const Muted: Story = {
  args: {
    tool: baseTool,
    muted: true,
    control: <PerChatSwitch />,
  },
};
