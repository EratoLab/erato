import { action } from "@storybook/addon-actions";
import { useState } from "react";

import { ChatInputAddMenu } from "../../components/ui/Chat/ChatInputAddMenu";
import {
  BrainIcon,
  CodeIcon,
  ComputerIcon,
  LinkIcon,
  SearchIcon,
} from "../../components/ui/icons";

import type { AddMenuToolItem } from "../../components/ui/Chat/ChatInputAddMenu";
import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof ChatInputAddMenu> = {
  title: "Chat/ChatInputAddMenu",
  component: ChatInputAddMenu,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Unified '+' menu for the chat input. Collapses file sources, host-injected sources (e.g. Outlook email content), and tool toggles into a single anchored popover. Presentational — the container wires data and behavior.",
      },
    },
  },
  decorators: [
    (Story) => (
      // The menu opens upward from the trigger, mirroring its position above
      // the chat input — give it room at the bottom of the canvas.
      <div className="flex h-[420px] w-[360px] items-end justify-start bg-theme-bg-primary p-4">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

const fileSources = [
  {
    id: "computer",
    label: "Upload from Computer",
    icon: <ComputerIcon className="size-4" />,
    onSelect: action("select: computer"),
  },
  {
    id: "sharepoint",
    label: "Upload from Sharepoint",
    icon: <LinkIcon className="size-4" />,
    onSelect: action("select: sharepoint"),
  },
];

const baseTools = [
  { id: "web", label: "Web search", icon: <SearchIcon className="size-4" /> },
  { id: "research", label: "Research", icon: <BrainIcon className="size-4" /> },
  {
    id: "code",
    label: "Code interpreter",
    icon: <CodeIcon className="size-4" />,
  },
];

/** Stateful wrapper so toggles actually flip in the canvas. */
function InteractiveMenu({
  initialChecked = [],
  onlySingle = false,
  ...rest
}: {
  initialChecked?: string[];
  onlySingle?: boolean;
} & Partial<Parameters<typeof ChatInputAddMenu>[0]>) {
  const [checked, setChecked] = useState<string[]>(initialChecked);

  const tools: AddMenuToolItem[] = baseTools.map((tool) => ({
    ...tool,
    checked: checked.includes(tool.id),
    onToggle: () => {
      action(`toggle: ${tool.id}`)();
      setChecked((prev) => {
        if (prev.includes(tool.id)) {
          return prev.filter((id) => id !== tool.id);
        }
        return onlySingle ? [tool.id] : [...prev, tool.id];
      });
    },
  }));

  return (
    <ChatInputAddMenu
      fileSources={fileSources}
      tools={tools}
      selectedCount={checked.length}
      {...rest}
    />
  );
}

export const Default: Story = {
  render: () => <InteractiveMenu />,
};

export const WithToolsSelected: Story = {
  name: "With tools selected (badge)",
  render: () => <InteractiveMenu initialChecked={["web", "research"]} />,
};

export const SingleFacetMode: Story = {
  name: "Single-tool mode (radio-like)",
  render: () => <InteractiveMenu initialChecked={["web"]} onlySingle />,
};

export const FilesOnly: Story = {
  render: () => <ChatInputAddMenu fileSources={fileSources} />,
};

/**
 * Many tools — the realistic "endless growth" case for a workspace with a long
 * facet list. The popover should cap at the available height and scroll
 * internally rather than overflow the viewport.
 */
export const ManyTools: Story = {
  render: () => (
    <ChatInputAddMenu
      fileSources={fileSources}
      tools={Array.from({ length: 14 }, (_, i) => ({
        id: `tool-${i}`,
        label: `Tool option number ${i + 1}`,
        icon: <CodeIcon className="size-4" />,
        checked: i % 3 === 0,
        onToggle: action(`toggle: tool-${i}`),
      }))}
      selectedCount={5}
    />
  ),
};

export const ToolsOnly: Story = {
  render: () => <InteractiveMenu fileSources={[]} />,
};

/**
 * Simulates the Outlook add-in contributing an "Email content" section via
 * the `extraSections` seam — the host supplies item data, the core menu owns
 * the rendering, dividers, and close-on-select while still owning file sources
 * and tools.
 */
export const WithEmailSection: Story = {
  name: "With host email section (Outlook)",
  render: () => (
    <InteractiveMenu
      extraSections={[
        {
          id: "email-content",
          header: "Email content",
          items: [
            {
              id: "email-thread",
              label: "Email thread",
              description: "Re: Q3 rollout (3 messages).eml · 42 KB",
              onSelect: action("select: email thread"),
            },
            {
              id: "attachment-proposal",
              label: "proposal.pdf",
              description: "application/pdf · 1.2 MB",
              onSelect: action("select: attachment"),
            },
          ],
        },
      ]}
    />
  ),
};

export const Processing: Story = {
  render: () => <InteractiveMenu isProcessing />,
};

export const Disabled: Story = {
  render: () => <InteractiveMenu disabled />,
};

export const Mobile: Story = {
  render: () => <InteractiveMenu initialChecked={["web", "research"]} />,
  parameters: {
    viewport: { defaultViewport: "mobile" },
  },
};
