import {
  ShieldCheckIcon,
  ShieldIcon,
  ShieldXmarkIcon,
} from "@/components/ui/icons";
import { toolDecisionLabel } from "@/lib/trace/toolDecisionLabel";

import { TraceConnector } from "../TraceConnector";
import { TraceStep } from "../TraceStep";

import type { ToolDecision } from "../Trace";
import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ToolDecisionTone } from "@/lib/trace/toolDecisionLabel";
import type { ReactNode } from "react";

const ICON_CLASS = "size-4";

interface DecisionLine {
  icon: ReactNode;
  label: string;
}

/**
 * Refused before it ran with no card answered, e.g. a saved "Never allow" or
 * a child with nowhere to ask. Such rows store `{ status: "rejected" }` and no
 * `allowed_by`; a call that ran has `allowed_by`, and its server may answer in
 * the same shape.
 */
export const refusedWithoutDecision = (
  part: ToolUse,
  decision: ToolDecision | undefined,
): boolean => {
  const output: unknown = part.output;
  return (
    decision === undefined &&
    part.allowed_by == null &&
    part.status === "error" &&
    typeof output === "object" &&
    output !== null &&
    (output as { status?: unknown }).status === "rejected"
  );
};

const TONE_ICON: Record<ToolDecisionTone, () => ReactNode> = {
  allowed: () => <ShieldCheckIcon className={ICON_CLASS} />,
  denied: () => <ShieldXmarkIcon className={ICON_CLASS} />,
  policy: () => <ShieldIcon className={ICON_CLASS} />,
};

const decisionLine = (
  part: ToolUse,
  decision: ToolDecision | undefined,
): DecisionLine | undefined => {
  const line = toolDecisionLabel(
    part,
    decision,
    refusedWithoutDecision(part, decision),
  );
  return line && { icon: TONE_ICON[line.tone](), label: line.label };
};

interface ToolDecisionRowProps {
  part: ToolUse;
  decision?: ToolDecision;
}

/**
 * Who allowed a tool call, on a row of its own above the call's result. Old
 * rows carry neither a decision nor `allowed_by` and get no row.
 */
export const ToolDecisionRow = ({ part, decision }: ToolDecisionRowProps) => {
  const line = decisionLine(part, decision);
  if (line === undefined) return null;
  return (
    <div data-testid="tool-decision-row">
      <TraceStep
        railIcon={line.icon}
        hasTrailingRailLine
        title={
          <span className="text-xs font-normal text-theme-fg-muted">
            {line.label}
          </span>
        }
      />
      <TraceConnector />
    </div>
  );
};
