import { t } from "@lingui/core/macro";

import { SettledInfoPill } from "../Trace/steps/ToolStatusPill";

import type { McpServerTool } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const NEUTRAL_PILL = "bg-theme-bg-tertiary text-theme-fg-secondary";
const ATTENTION_PILL = "bg-theme-warning-bg text-theme-warning-fg";

/**
 * Every badge is a straight lookup on a field the backend already decided;
 * the same function that gates a run produced these values, so nothing here
 * may re-derive them (an unannotated tool is NOT read-only under protocol
 * defaults, and only the backend knows the configured preset).
 */
export const mcpToolBadges = (tool: McpServerTool) => {
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
  if (tool.policy === "ask") {
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

/**
 * One tool's identity line: title, wire name where it differs, description
 * and the backend-decided badges. The settings row adds the decision radios
 * under it; the composer's tool browser shows it alone, so both surfaces
 * describe a tool with the same words.
 */
export function McpToolSummary({ tool }: { tool: McpServerTool }) {
  return (
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
        {mcpToolBadges(tool).map((badge) => (
          <li key={badge.label}>
            <SettledInfoPill
              label={badge.label}
              toneClassName={badge.toneClassName}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
