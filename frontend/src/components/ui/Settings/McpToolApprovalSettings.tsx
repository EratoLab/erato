import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";

import {
  useCreateUserToolApprovalSetting,
  useDeactivateUserToolApprovalSetting,
  useListMcpServerTools,
  useListUserToolApprovalSettings,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { RadioCard } from "../Controls/RadioCard";
import { Alert } from "../Feedback/Alert";
import { SettledInfoPill } from "../Trace/steps/ToolStatusPill";

import type {
  McpServerTool,
  UserToolApprovalSetting,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

// A listed roster only moves on a redeploy, and the backend serves a repeat
// expand from its own session cache within this window anyway. Anything
// short of a listing is retried on the next expand instead of being cached.
const TOOLS_STALE_TIME_MS = 5 * 60 * 1000;

const NEUTRAL_PILL = "bg-theme-bg-tertiary text-theme-fg-secondary";
const ATTENTION_PILL = "bg-theme-warning-bg text-theme-warning-fg";

/** The radio state of one tool; "ask" is the absence of a stored decision. */
export type McpToolDecision = "ask" | "always" | "never";

/**
 * A stored row is a decision, never a grant by itself: the same table holds
 * denials, so presence alone must not read as "always".
 */
export const decisionOfSetting = (
  setting: UserToolApprovalSetting | undefined,
): McpToolDecision => {
  if (setting === undefined) {
    return "ask";
  }
  return setting.decision === "denied" ? "never" : "always";
};

/**
 * What the row shows for a stored decision. A grant is only honored by the
 * gate while the policy allows persistent grants and the tool would ask at
 * all, so outside that a stale grant reads as the default state — the same
 * fold the tool roster applies to `user_decision`.
 */
export const shownDecision = (
  stored: McpToolDecision,
  offersAlways: boolean,
): McpToolDecision => (stored === "always" && !offersAlways ? "ask" : stored);

/**
 * Every badge is a straight lookup on a field the backend already decided;
 * the same function that gates a run produced these values, so nothing here
 * may re-derive them (an unannotated tool is NOT read-only under protocol
 * defaults, and only the backend knows the configured preset).
 */
const toolBadges = (tool: McpServerTool) => {
  const badges: { label: string; toneClassName: string }[] = [];
  if (tool.annotations.read_only_hint) {
    badges.push({
      label: t({
        id: "preferences.dialog.mcpServers.tools.badge.readsOnly",
        message: "Reads only",
      }),
      toneClassName: NEUTRAL_PILL,
    });
  } else {
    badges.push({
      label: t({
        id: "preferences.dialog.mcpServers.tools.badge.canModify",
        message: "Can modify",
      }),
      toneClassName: ATTENTION_PILL,
    });
  }
  if (tool.annotations.open_world_hint) {
    badges.push({
      label: t({
        id: "preferences.dialog.mcpServers.tools.badge.reachesOtherSystems",
        message: "Reaches other systems",
      }),
      toneClassName: NEUTRAL_PILL,
    });
  }
  if (!tool.annotations.annotated) {
    badges.push({
      label: t({
        id: "preferences.dialog.mcpServers.tools.badge.notDeclared",
        message: "Not declared by the server",
      }),
      toneClassName: NEUTRAL_PILL,
    });
  }
  if (tool.approval === "ask") {
    badges.push({
      label: t({
        id: "preferences.dialog.mcpServers.tools.badge.asksBeforeRunning",
        message: "Asks before running",
      }),
      toneClassName: NEUTRAL_PILL,
    });
  }
  return badges;
};

function McpToolRow({
  tool,
  decision,
  allowAlways,
  radioGroupName,
  disabled,
  onDecide,
}: {
  tool: McpServerTool;
  decision: McpToolDecision;
  allowAlways: boolean;
  radioGroupName: string;
  disabled: boolean;
  onDecide: (decision: McpToolDecision) => void;
}) {
  const asksBeforeRunning = tool.approval === "ask";
  // A tool the policy runs unprompted never asks, so a persistent grant would
  // change nothing for it; and the gate ignores grants while the policy does
  // not honor them. Either way the option is not offered.
  const offersAlways = asksBeforeRunning && allowAlways;
  const shown = shownDecision(decision, offersAlways);

  return (
    <div
      role="radiogroup"
      aria-label={tool.title}
      className="space-y-2"
      data-testid="mcp-tool-approval-row"
      data-tool-name={tool.name}
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium text-theme-fg-primary">
            {tool.title}
          </span>
          {tool.title !== tool.name ? (
            <span className="font-mono text-xs text-theme-fg-muted">
              {tool.name}
            </span>
          ) : null}
        </div>
        {tool.description ? (
          <p className="text-xs text-theme-fg-secondary">{tool.description}</p>
        ) : null}
        <ul className="flex flex-wrap gap-1" aria-label={tool.title}>
          {toolBadges(tool).map((badge) => (
            <li key={badge.label}>
              <SettledInfoPill
                label={badge.label}
                toneClassName={badge.toneClassName}
              />
            </li>
          ))}
        </ul>
      </div>
      {/* The default state of a tool that never asks is plain "allowed". */}
      <RadioCard
        size="sm"
        name={radioGroupName}
        value="ask"
        checked={shown === "ask"}
        disabled={disabled}
        onChange={() => onDecide("ask")}
        label={
          asksBeforeRunning
            ? t({
                id: "preferences.dialog.mcpServers.approvals.ask.label",
                message: "Ask each time",
              })
            : t({
                id: "preferences.dialog.mcpServers.approvals.allow.label",
                message: "Allow",
              })
        }
        helper={
          asksBeforeRunning
            ? t({
                id: "preferences.dialog.mcpServers.approvals.ask.helper",
                message:
                  "Shows the in-chat confirmation each time this tool wants to run.",
              })
            : t({
                id: "preferences.dialog.mcpServers.approvals.allow.helper",
                message:
                  "Runs without asking; the approval policy does not stop this tool.",
              })
        }
      />
      {offersAlways ? (
        <RadioCard
          size="sm"
          name={radioGroupName}
          value="always"
          checked={shown === "always"}
          disabled={disabled}
          onChange={() => onDecide("always")}
          label={t({
            id: "preferences.dialog.mcpServers.approvals.always.label",
            message: "Always allow",
          })}
          helper={t({
            id: "preferences.dialog.mcpServers.approvals.always.helper",
            message: "Runs this tool without asking.",
          })}
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
  );
}

/**
 * One MCP server's tools as the user's generations see them, each with the
 * user's persistent decision for it. The roster comes from the server's
 * enumeration and the decisions from the stored settings, so every tool is
 * listed whether or not it has ever been decided on. Mounted inside the
 * server's entity row, whose details unmount on collapse, so mounting IS the
 * expand and the enumeration happens once per expand — repeat expands inside
 * the stale window come from the query cache.
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
    const setting = settingByToolName.get(tool.name);
    if (decisionOfSetting(setting) === next) {
      return;
    }
    setMutationError(null);
    setPendingTool(tool.name);
    try {
      if (next === "ask") {
        if (setting !== undefined) {
          await deactivateSetting({ pathParams: { settingId: setting.id } });
        }
      } else {
        await createSetting({
          body: {
            mcp_server_id: serverId,
            tool_name: tool.name,
            // eslint-disable-next-line lingui/no-unlocalized-strings -- API decision value
            decision: next === "always" ? "always_allow" : "denied",
          },
        });
      }
      await refetchSettings();
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
    body = (
      <div className="space-y-4">
        {toolsResponse.tools.map((tool) => (
          <McpToolRow
            key={tool.name}
            tool={tool}
            decision={decisionOfSetting(settingByToolName.get(tool.name))}
            allowAlways={toolsResponse.allow_always}
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
