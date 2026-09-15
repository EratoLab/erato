import { useId, useState } from "react";

import { mcpToolGroupLabel } from "./mcpToolGroups";
import { CountBadge } from "../Controls/CountBadge";
import { DisclosureChevron } from "../Controls/DisclosureChevron";

import type { McpToolGroupKey } from "./mcpToolGroups";
import type { ReactNode } from "react";

export interface McpToolGroupProps {
  group: McpToolGroupKey;
  /** How many rows the group holds; read out with the label. */
  count: number;
  /**
   * Trailing control on the header line — the settings roster's group
   * decision — outside the disclosure button, so it is never mistaken for
   * a way to open the group.
   */
  action?: ReactNode;
  /** A transient line under the header, e.g. what a group decision skipped. */
  note?: ReactNode;
  /** The rows, each a `li`. */
  children: ReactNode;
  "data-testid"?: string;
}

/**
 * One annotation class of a server's tools, in both the settings roster and
 * the composer's tool browser: a disclosure header (chevron, label, count)
 * over the rows, open by default because the roster IS the content. Closing
 * takes the rows out of the DOM so a closed group leaves no tab stops.
 */
export function McpToolGroup({
  group,
  count,
  action,
  note,
  children,
  "data-testid": dataTestId,
}: McpToolGroupProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const panelId = useId();

  return (
    <section
      data-testid={dataTestId}
      data-tool-group={group}
      className="space-y-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={panelId}
          onClick={() => setIsExpanded((value) => !value)}
          className="theme-transition focus-ring-tight flex min-w-0 items-center gap-2 rounded-sm text-left"
          data-testid="mcp-tool-group-toggle"
        >
          <DisclosureChevron open={isExpanded} size="md" />
          <span className="text-sm font-medium text-theme-fg-primary">
            {mcpToolGroupLabel(group)}
          </span>
          {/* The button has no other place to say the count, so the badge
              stays in its accessible name. */}
          <CountBadge variant="count" aria-hidden={false}>
            {count}
          </CountBadge>
        </button>
        {action !== undefined && action !== null ? (
          <div className="ml-auto max-w-full">{action}</div>
        ) : null}
      </div>
      {note !== undefined && note !== null ? (
        <p role="status" className="pl-6 text-xs text-theme-fg-secondary">
          {note}
        </p>
      ) : null}
      {isExpanded ? (
        <ul id={panelId} className="space-y-3 pl-1">
          {children}
        </ul>
      ) : null}
    </section>
  );
}
