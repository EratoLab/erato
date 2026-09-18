import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useId, useState } from "react";

import { DisclosureChevron } from "../Controls/DisclosureChevron";
import { SettledInfoPill } from "../Trace/steps/ToolStatusPill";

import type { McpServerTool } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

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
  if (tool.effective === "ask") {
    badges.push({
      label: t({
        id: "preferences.dialog.mcpServers.tools.badge.asksBeforeRunning",
        message: "Asks before running",
      }),
      toneClassName: NEUTRAL_PILL,
    });
  }
  // Tells a standing decision apart from the policy reaching the same state.
  if (tool.user_decision !== "none") {
    badges.push({
      label: t({
        id: "preferences.dialog.mcpServers.tools.badge.setByYou",
        message: "Set by you",
      }),
      toneClassName: NEUTRAL_PILL,
    });
  }
  return badges;
};

export interface McpToolRowProps {
  tool: McpServerTool;
  /**
   * The row's own control, trailing the identity: the settings pane's
   * decision radios, the tool browser's per-chat switch. It keeps its own
   * width and wraps under the title where the row cannot hold both.
   */
  control?: ReactNode;
  /** Dims the identity, for a tool the chat has switched off. */
  muted?: boolean;
  /** `li` inside a list of tools; a plain `div` otherwise. */
  as?: "div" | "li";
  "data-testid"?: string;
}

/**
 * One MCP tool as both the settings roster and the composer's tool browser
 * show it: a disclosure chevron, the title (the wire name beside it where
 * the two differ), the backend-decided badges, and the caller's control.
 *
 * Title, name and description are vendor-authored text. The backend has
 * bounded and de-fanged the title and description and hands the name over
 * verbatim, because the name is the key this row's control posts back; the
 * row finishes the job by showing all three as inert text only — no markup,
 * no links — each in a container that isolates its writing direction, so a
 * hostile string can neither reorder the row around it nor run anything. The description is
 * collapsed by default because vendors write tutorials into it and a
 * roster is read at a glance.
 */
export function McpToolRow({
  tool,
  control,
  muted = false,
  as: Tag = "div",
  "data-testid": dataTestId,
}: McpToolRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const panelId = useId();
  const hasDescription = Boolean(tool.description);
  const toolTitle = tool.title;

  return (
    <Tag
      data-testid={dataTestId}
      data-tool-name={tool.name}
      className="flex flex-wrap items-start gap-x-3 gap-y-2"
    >
      <div
        className={clsx(
          "min-w-0 flex-1 basis-56 space-y-1",
          muted && "opacity-60",
        )}
      >
        <div className="flex items-start gap-2">
          {hasDescription ? (
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-controls={panelId}
              aria-label={t({
                id: "preferences.dialog.tools.descriptionToggle",
                message: `Description of ${toolTitle}`,
              })}
              onClick={() => setIsExpanded((value) => !value)}
              className="theme-transition focus-ring-tight mt-0.5 shrink-0 rounded-sm"
              data-testid="mcp-tool-row-toggle"
            >
              <DisclosureChevron open={isExpanded} size="md" />
            </button>
          ) : (
            // Keeps the titles of a roster aligned whether or not the
            // server described the tool.
            <span aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 items-baseline gap-x-2">
              <span
                dir="auto"
                className="truncate text-sm font-medium text-theme-fg-primary [unicode-bidi:isolate]"
                title={tool.title}
              >
                {tool.title}
              </span>
              {tool.title !== tool.name ? (
                // The name arrives as the server declared it, so it is the
                // one string here the backend did not clean; it can only
                // affect its own span.
                <span
                  dir="auto"
                  className="truncate font-mono text-xs text-theme-fg-muted [unicode-bidi:isolate]"
                  title={tool.name}
                >
                  {tool.name}
                </span>
              ) : null}
            </div>
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
        </div>
        {hasDescription && isExpanded ? (
          <div id={panelId} className="space-y-1 pl-6">
            <div
              dir="auto"
              data-testid="mcp-tool-row-description"
              className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs text-theme-fg-secondary [overflow-wrap:anywhere] [unicode-bidi:isolate]"
            >
              {tool.description}
            </div>
            {tool.description_truncated ? (
              <p className="text-xs italic text-theme-fg-muted">
                {t({
                  id: "preferences.dialog.tools.descriptionShortened",
                  message: "Description shortened by Erato",
                })}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {control !== undefined && control !== null ? (
        <div className="ml-auto max-w-full shrink-0">{control}</div>
      ) : null}
    </Tag>
  );
}
