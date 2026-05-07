import { t } from "@lingui/core/macro";

import { HourglassIcon } from "@/components/ui/icons";

import { TraceRailIcon } from "./TraceRailIcon";

interface TraceThinkingPlaceholderProps {
  /** Whether this is the bottom of the timeline (no rail line below). */
  isLastNode: boolean;
}

/**
 * A transient "Thinking…" row that appears in the middle of an active stream
 * when no new event has arrived for a short period. Indicates that the model
 * is mid-thought between two visible blocks (e.g. between a tool result and
 * the next reasoning step).
 *
 * Stateless — visibility is decided by the parent based on `useThinkingGap`.
 */
export const TraceThinkingPlaceholder = ({
  isLastNode,
}: TraceThinkingPlaceholderProps) => (
  <div className="flex flex-row">
    <TraceRailIcon
      icon={<HourglassIcon className="size-4" />}
      hasTrailingLine={!isLastNode}
      isActive
    />
    <div className="min-w-0 flex-1 pl-2.5 pt-0.5 text-sm italic text-theme-fg-muted">
      <span className="animate-pulse">{t`Thinking…`}</span>
    </div>
  </div>
);
