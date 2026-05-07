import clsx from "clsx";

interface TraceConnectorProps {
  /** When false, no line is drawn (used at the timeline's top/bottom caps). */
  hasLine?: boolean;
}

/**
 * The 8px vertical spacer that sits between two `TraceStep`s. Renders a
 * 1px line in the rail column, aligned with the step icons above/below.
 *
 * Together with the step's own intra-rail line (a `flex-1` filler beside the
 * icon), this produces a single uninterrupted vertical line that scales with
 * step content height — no JS measurement needed.
 */
export const TraceConnector = ({ hasLine = true }: TraceConnectorProps) => (
  <div className="flex h-2 flex-row">
    <div className="flex w-5 justify-center">
      <div
        className={clsx(
          "h-full w-px",
          hasLine ? "bg-theme-border" : undefined,
        )}
      />
    </div>
  </div>
);
