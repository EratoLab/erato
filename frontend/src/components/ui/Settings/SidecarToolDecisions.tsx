import { t } from "@lingui/core/macro";

import {
  SIDECAR_CHAT_TOOL_METHODS,
  sidecarQualifiedToolName,
  sidecarToolAvailable,
} from "@/lib/desktopSidecar/chatTools";
import { sidecarToolLabel } from "@/lib/desktopSidecar/toolLabels";

import { ClientToolDecisionList } from "./ClientToolDecisionList";

import type { DesktopSidecarClient } from "@erato/desktop-sidecar-protocol";

/** Tools the connected sidecar can run, each with the user's standing decision. */
export function SidecarToolDecisions({
  client,
}: {
  client: DesktopSidecarClient;
}) {
  const tools = SIDECAR_CHAT_TOOL_METHODS.filter((tool) =>
    sidecarToolAvailable(client, tool),
  ).map(({ name }) => ({
    qualifiedName: sidecarQualifiedToolName(name),
    label: sidecarToolLabel(name),
    "data-testid": `sidecar-tool-decision-${name}`,
  }));
  return (
    <ClientToolDecisionList
      tools={tools}
      defaultDecision="allow"
      heading={t({
        id: "preferences.dialog.desktopSidecar.tools.heading",
        message: "Available tools",
      })}
      data-testid="sidecar-tool-decisions"
    />
  );
}
