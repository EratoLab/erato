import { t } from "@lingui/core/macro";

import { ActionConfirmationCard } from "./ActionConfirmationCard";
import { ApprovalReferent, ApprovalTechnicalDetails } from "./ApprovalReferent";

import type { ActionConfirmationStatus } from "./ActionConfirmationCard";
import type {
  ToolApprovalDecision,
  ToolDisplayMetadata,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * The turn's own gated call: what it does, or the tool and its input, above
 * the consent card. Rendered as the whole card for a single call, and as one item
 * of a queue when the turn's tasks asked in the same batch.
 */
export const OwnCallApprovalItem = ({
  toolName,
  display,
  input,
  serverId,
  isClientTool,
  openWorld,
  allowAlways,
  status,
  resolvedLabel,
  isBusy,
  scrollIntoViewOnMount,
  onDecide,
}: {
  toolName: string;
  display?: ToolDisplayMetadata | null;
  input: unknown;
  /** The MCP server, or a client tool's namespace. */
  serverId: string;
  isClientTool: boolean;
  openWorld: boolean;
  allowAlways: boolean;
  status: ActionConfirmationStatus;
  resolvedLabel: string | undefined;
  isBusy: boolean;
  scrollIntoViewOnMount: boolean;
  onDecide: (decision: ToolApprovalDecision) => void;
}) => (
  <>
    <ApprovalReferent
      toolName={toolName}
      display={display}
      input={input}
      serverId={serverId}
      isClientTool={isClientTool}
    />
    <ActionConfirmationCard
      title={
        isClientTool
          ? t({
              id: "clientToolApproval.title",
              message: "Allow this tool to run on your device?",
            })
          : t({
              id: "mcpApproval.title",
              message: "Allow MCP tool call?",
            })
      }
      // A client tool declares no annotations of its own; the defaults it
      // carries describe nothing about what it does.
      description={
        !isClientTool && openWorld
          ? t({
              id: "mcpApproval.openWorldWarning",
              message: "This tool may send data to an external service.",
            })
          : undefined
      }
      onAllowOnce={() => onDecide("approve")}
      // Keep "Always allow" discoverable when the deployment enforces
      // per-use confirmation: greyed out with the reason, like the add-in's
      // locked client-action decisions, instead of silently missing.
      // eslint-disable-next-line lingui/no-unlocalized-strings -- API decision value
      onAlwaysAllow={() => onDecide("approve_always")}
      alwaysAllowDisabledReason={
        allowAlways
          ? undefined
          : t({
              id: "mcpApproval.alwaysAllowDisabled",
              message:
                "Locked: your organization requires confirmation each time this tool runs.",
            })
      }
      onDeny={() => onDecide("reject")}
      // eslint-disable-next-line lingui/no-unlocalized-strings -- API decision value
      onNeverAllow={() => onDecide("reject_always")}
      status={status}
      resolvedLabel={resolvedLabel}
      isBusy={isBusy}
      scrollIntoViewOnMount={scrollIntoViewOnMount}
      data-testid="mcp-tool-approval-card"
    />
    <ApprovalTechnicalDetails
      toolName={toolName}
      display={display}
      input={input}
      serverId={serverId}
      isClientTool={isClientTool}
    />
  </>
);
