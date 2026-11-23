import { action } from "@storybook/addon-actions";
import { useState } from "react";

import { McpToolsBrowserModal } from "@/components/ui/Chat/McpToolsBrowserModal";

import type { McpServerStatus } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Meta, StoryObj } from "@storybook/react";

/**
 * The connectors dialog behind the composer's "Connectors…" row: a search over
 * the servers' names, a per-chat switch on each connected server, Connect on
 * the ones still waiting for the user (listed last), and the chat's "Allow
 * changes" switch in the footer. Every part is an existing component (modal,
 * input, entity row, checkbox, button), so a customer theme reaches all of it.
 */
const meta = {
  title: "UI/McpToolsBrowserModal",
  component: McpToolsBrowserModal,
  parameters: { layout: "centered" },
} satisfies Meta<typeof McpToolsBrowserModal>;

export default meta;
type Story = StoryObj<typeof meta>;

const SERVERS: McpServerStatus[] = [
  {
    id: "business_central",
    display_name: "Business Central",
    connection_status: "SUCCESS",
    authentication_mode: "forwarded",
  },
  {
    id: "dynamics",
    display_name: "Dynamics 365",
    connection_status: "SUCCESS",
    authentication_mode: "forwarded",
  },
  {
    id: "kertos",
    display_name: "Kertos",
    connection_status: "NEEDS_AUTHENTICATION",
    authentication_mode: "oauth2",
  },
  {
    id: "teams",
    display_name: "Microsoft Teams",
    connection_status: "SUCCESS",
    authentication_mode: "forwarded",
  },
  {
    id: "wiki",
    display_name: "Wiki",
    connection_status: "FAILURE",
    authentication_mode: "none",
  },
];

function InteractiveDialog({
  pausesHostActions = false,
  initialWriteToolsEnabled = true,
}: {
  pausesHostActions?: boolean;
  initialWriteToolsEnabled?: boolean;
}) {
  const [disabledServerIds, setDisabledServerIds] = useState<string[]>([
    "teams",
  ]);
  const [writeToolsEnabled, setWriteToolsEnabled] = useState(
    initialWriteToolsEnabled,
  );
  return (
    <McpToolsBrowserModal
      isOpen
      onClose={action("close")}
      servers={SERVERS}
      disabledServerIds={disabledServerIds}
      onToggleServer={(serverId) => {
        action("toggle server")(serverId);
        setDisabledServerIds((previous) =>
          previous.includes(serverId)
            ? previous.filter((id) => id !== serverId)
            : [...previous, serverId],
        );
      }}
      disabledToolPatterns={[]}
      onToggleTool={action("toggle tool")}
      writeToolsEnabled={writeToolsEnabled}
      onToggleWriteTools={() => setWriteToolsEnabled((previous) => !previous)}
      pausesHostActions={pausesHostActions}
    />
  );
}

export const Connectors: Story = {
  args: { isOpen: true, onClose: () => {}, servers: SERVERS },
  render: () => <InteractiveDialog />,
};

export const ConnectorsInAddinWithChangesOff: Story = {
  args: { isOpen: true, onClose: () => {}, servers: SERVERS },
  render: () => (
    <InteractiveDialog pausesHostActions initialWriteToolsEnabled={false} />
  ),
};
