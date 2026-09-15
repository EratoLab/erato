import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";

import {
  useCreateUserToolApprovalSetting,
  useDeactivateUserToolApprovalSetting,
  useListMcpServerTools,
  useListUserToolApprovalSettings,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { McpToolRow } from "./McpToolRow";
import { RadioCard } from "../Controls/RadioCard";
import { Alert } from "../Feedback/Alert";

import type {
  McpServerTool,
  McpServerToolPolicy,
  McpToolEffectiveState,
  UserToolApprovalSetting,
  UserToolDecision,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

// A listed roster only moves on a redeploy, and the backend serves a repeat
// expand from its own session cache within this window anyway. Anything
// short of a listing is retried on the next expand instead of being cached.
const TOOLS_STALE_TIME_MS = 5 * 60 * 1000;

/** The three states a tool row offers; each is one effective state. */
export type McpToolDecision = "allow" | "ask" | "never";

const decisionOfEffective = (
  effective: McpToolEffectiveState,
): McpToolDecision => (effective === "denied" ? "never" : effective);

/** The state the policy puts a tool in when the user has decided nothing. */
const policyDefault = (policy: McpServerToolPolicy): McpToolDecision =>
  policy === "ask" ? "ask" : "allow";

/** Which options the deployment lets the user store for one tool. */
export interface McpToolDecisionAvailability {
  allowAlways: boolean;
  askAvailable: boolean;
}

/**
 * The options a row shows. The policy default is always there, as is
 * "Never allow" (strictly more restrictive, honored regardless of policy).
 * The remaining option is a stored decision the gate only honors while the
 * deployment allows it, so it is not offered otherwise.
 */
export const offeredDecisions = (
  policy: McpServerToolPolicy,
  availability: McpToolDecisionAvailability,
): McpToolDecision[] => {
  const offered: McpToolDecision[] = [];
  if (policy === "auto" || availability.allowAlways) {
    offered.push("allow");
  }
  if (policy === "ask" || availability.askAvailable) {
    offered.push("ask");
  }
  offered.push("never");
  return offered;
};

/** The stored decision a non-default option stands for. */
const storedDecisionOf = (
  decision: Exclude<McpToolDecision, "never">,
): UserToolDecision =>
  // eslint-disable-next-line lingui/no-unlocalized-strings -- API decision value
  decision === "allow" ? "always_allow" : "ask";

function McpToolDecisionRow({
  tool,
  availability,
  radioGroupName,
  disabled,
  onDecide,
}: {
  tool: McpServerTool;
  availability: McpToolDecisionAvailability;
  radioGroupName: string;
  disabled: boolean;
  onDecide: (decision: McpToolDecision) => void;
}) {
  // What the row shows is what the backend says will happen; a stored
  // decision the policy does not honor is folded there, not here.
  const shown = decisionOfEffective(tool.effective);
  const isDefault = policyDefault(tool.policy);
  const offered = offeredDecisions(tool.policy, availability);

  return (
    <McpToolRow
      tool={tool}
      data-testid="mcp-tool-approval-row"
      control={
        <div
          role="radiogroup"
          aria-label={tool.title}
          className="w-72 max-w-full space-y-2"
        >
          {offered.includes("allow") ? (
            <RadioCard
              size="sm"
              name={radioGroupName}
              value="allow"
              checked={shown === "allow"}
              disabled={disabled}
              onChange={() => onDecide("allow")}
              label={
                isDefault === "allow"
                  ? t({
                      id: "preferences.dialog.mcpServers.approvals.allow.defaultLabel",
                      message: "Allow (policy default)",
                    })
                  : t({
                      id: "preferences.dialog.mcpServers.approvals.allow.label",
                      message: "Allow",
                    })
              }
              helper={
                isDefault === "allow"
                  ? t({
                      id: "preferences.dialog.mcpServers.approvals.allow.helper",
                      message:
                        "Runs without asking; the approval policy does not stop this tool.",
                    })
                  : t({
                      id: "preferences.dialog.mcpServers.approvals.always.helper",
                      message: "Runs this tool without asking.",
                    })
              }
            />
          ) : null}
          {offered.includes("ask") ? (
            <RadioCard
              size="sm"
              name={radioGroupName}
              value="ask"
              checked={shown === "ask"}
              disabled={disabled}
              onChange={() => onDecide("ask")}
              label={
                isDefault === "ask"
                  ? t({
                      id: "preferences.dialog.mcpServers.approvals.ask.defaultLabel",
                      message: "Ask each time (policy default)",
                    })
                  : t({
                      id: "preferences.dialog.mcpServers.approvals.ask.label",
                      message: "Ask each time",
                    })
              }
              helper={
                isDefault === "ask"
                  ? t({
                      id: "preferences.dialog.mcpServers.approvals.ask.helper",
                      message:
                        "Shows the in-chat confirmation each time this tool wants to run.",
                    })
                  : t({
                      id: "preferences.dialog.mcpServers.approvals.ask.escalationHelper",
                      message:
                        "Asks you before every run, even where the policy would not.",
                    })
              }
            />
          ) : null}
          <RadioCard
            size="sm"
            name={radioGroupName}
            value="never"
            checked={shown === "never"}
            disabled={disabled}
            onChange={() => onDecide("never")}
            label={t({
              id: "preferences.dialog.mcpServers.approvals.never.label",
              message: "Never allow",
            })}
            helper={t({
              id: "preferences.dialog.mcpServers.approvals.never.helper",
              message:
                "Keeps this tool away from the assistant and blocks it even when a confirmation is already waiting.",
            })}
          />
        </div>
      }
    />
  );
}

/**
 * One MCP server's tools as the user's generations see them, each with the
 * user's persistent decision for it. The roster carries the policy default,
 * the stored decision and the effective state per tool, so the rows render
 * what the backend decided and never derive it; the stored settings are
 * fetched only to address the row a "policy default" choice deactivates.
 * Mounted inside the server's entity row, whose details unmount on collapse,
 * so mounting IS the expand and the enumeration happens once per expand —
 * repeat expands inside the stale window come from the query cache.
 */
export function McpToolApprovalSettings({
  serverId,
  isActive,
}: {
  serverId: string;
  /** Gates the fetches to the tab actually being shown. */
  isActive: boolean;
}) {
  const radioGroupName = useId();
  const [pendingTool, setPendingTool] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const {
    data: toolsResponse,
    error: toolsError,
    isLoading: isToolsLoading,
    refetch: refetchTools,
  } = useListMcpServerTools(
    isActive ? { pathParams: { serverId } } : skipToken,
    {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: (query) =>
        query.state.data?.status === "SUCCESS" ? TOOLS_STALE_TIME_MS : 0,
    },
  );
  const {
    data: settingsResponse,
    error: settingsError,
    refetch: refetchSettings,
  } = useListUserToolApprovalSettings(isActive ? {} : skipToken, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const { mutateAsync: createSetting } = useCreateUserToolApprovalSetting();
  const { mutateAsync: deactivateSetting } =
    useDeactivateUserToolApprovalSetting();

  const settingByToolName = useMemo(() => {
    const map = new Map<string, UserToolApprovalSetting>();
    for (const setting of settingsResponse?.settings ?? []) {
      if (setting.mcp_server_id === serverId) {
        map.set(setting.tool_name, setting);
      }
    }
    return map;
  }, [settingsResponse, serverId]);

  const decide = async (tool: McpServerTool, next: McpToolDecision) => {
    if (decisionOfEffective(tool.effective) === next) {
      return;
    }
    setMutationError(null);
    setPendingTool(tool.name);
    try {
      if (next === policyDefault(tool.policy)) {
        const setting = settingByToolName.get(tool.name);
        if (setting !== undefined) {
          await deactivateSetting({ pathParams: { settingId: setting.id } });
        }
      } else {
        await createSetting({
          body: {
            mcp_server_id: serverId,
            tool_name: tool.name,
            decision: next === "never" ? "denied" : storedDecisionOf(next),
          },
        });
      }
      // The effective state is the backend's to say, so the roster is read
      // back rather than patched locally.
      await Promise.all([refetchSettings(), refetchTools()]);
    } catch {
      setMutationError(
        t({
          id: "preferences.dialog.mcpServers.approvals.updateError",
          message: "Could not update the decision. Please try again.",
        }),
      );
    } finally {
      setPendingTool(null);
    }
  };

  let body: ReactNode = null;
  if (toolsError) {
    body = (
      <Alert type="error">
        {t({
          id: "preferences.dialog.mcpServers.tools.loadError",
          message: "Could not load the tools of this server. Please try again.",
        })}
      </Alert>
    );
  } else if (isToolsLoading || !toolsResponse) {
    body = (
      <p className="text-xs text-theme-fg-secondary">
        {t({
          id: "preferences.dialog.mcpServers.tools.loading",
          message: "Loading tools...",
        })}
      </p>
    );
  } else if (toolsResponse.status === "NEEDS_AUTHENTICATION") {
    body = (
      <p className="text-xs text-theme-fg-secondary">
        {t({
          id: "preferences.dialog.mcpServers.tools.needsAuthentication",
          message: "Connect to see tools.",
        })}
      </p>
    );
  } else if (toolsResponse.status !== "SUCCESS") {
    body = (
      <p className="text-xs text-theme-fg-secondary">
        {t({
          id: "preferences.dialog.mcpServers.tools.failure",
          message:
            "The tools could not be listed because the server is unreachable.",
        })}
      </p>
    );
  } else if (toolsResponse.tools.length === 0) {
    body = (
      <p className="text-sm italic text-theme-fg-muted">
        {t({
          id: "preferences.dialog.mcpServers.tools.empty",
          message: "This server exposes no tools to you.",
        })}
      </p>
    );
  } else {
    const availability: McpToolDecisionAvailability = {
      allowAlways: toolsResponse.allow_always,
      askAvailable: toolsResponse.ask_available,
    };
    body = (
      <div className="space-y-4">
        {toolsResponse.tools.map((tool) => (
          <McpToolDecisionRow
            key={tool.name}
            tool={tool}
            availability={availability}
            radioGroupName={`${radioGroupName}-${tool.name}`}
            disabled={pendingTool !== null}
            onDecide={(next) => void decide(tool, next)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="mcp-tool-approval-settings">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-theme-fg-primary">
          {t({
            id: "preferences.dialog.mcpServers.tools.heading",
            message: "Tools",
          })}
        </h3>
        <p className="text-xs text-theme-fg-secondary">
          {t({
            id: "preferences.dialog.mcpServers.tools.description",
            message:
              'Decide for each tool of this server whether it may run for you. Decisions apply to your account on every device; choosing "Always allow" in a chat is stored here too.',
          })}
        </p>
      </div>

      {settingsError ? (
        <Alert type="error">
          {t({
            id: "preferences.dialog.mcpServers.approvals.loadError",
            message: "Could not load your tool decisions. Please try again.",
          })}
        </Alert>
      ) : null}
      {mutationError ? <Alert type="error">{mutationError}</Alert> : null}

      {body}
    </div>
  );
}
