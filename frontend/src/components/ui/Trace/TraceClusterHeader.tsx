import { t } from "@lingui/core/macro";
import clsx from "clsx";

import { ChevronRightIcon } from "@/components/ui/icons";

import { formatThinkingDuration } from "./hooks/useThinkingDuration";

interface TraceClusterHeaderProps {
  /** Total trace duration in ms (or null if unknown). */
  durationMs: number | null;
  /** When true, label shifts to "Stopped after Xs" / "Stopped". */
  hasError?: boolean;
  /** Whether the timeline below is currently expanded. */
  isOpen: boolean;
  /** Toggle handler. */
  onToggle: () => void;
}

const buildLabel = (durationMs: number | null, hasError: boolean): string => {
  const formatted = formatThinkingDuration(durationMs);

  if (hasError) {
    return formatted ? t`Stopped after ${formatted}` : t`Stopped`;
  }
  return formatted ? t`Thought for ${formatted}` : t`Thought`;
};

/**
 * The cold-load summary "pill" rendered above the timeline. Toggles the
 * full reasoning + tool-call timeline visible/hidden when clicked.
 *
 * Only rendered for completed (non-streaming) traces — during streaming,
 * the parent omits it and the live timeline is shown directly.
 */
export const TraceClusterHeader = ({
  durationMs,
  hasError = false,
  isOpen,
  onToggle,
}: TraceClusterHeaderProps) => {
  const label = buildLabel(durationMs, hasError);

  return (
    <button
      type="button"
      aria-expanded={isOpen}
      onClick={onToggle}
      className={clsx(
        "flex items-center gap-2 rounded-full px-3 py-1 text-sm",
        "text-theme-fg-secondary transition-colors hover:text-theme-fg-primary",
        "cursor-pointer",
      )}
    >
      <span className="font-medium">{label}</span>
      <ChevronRightIcon
        aria-hidden="true"
        className={clsx(
          "size-3 shrink-0 text-theme-fg-muted transition-transform",
          isOpen ? "rotate-90" : "rotate-0",
        )}
      />
    </button>
  );
};
