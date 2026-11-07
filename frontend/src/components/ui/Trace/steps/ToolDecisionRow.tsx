import { t } from "@lingui/core/macro";

import {
  ShieldCheckIcon,
  ShieldIcon,
  ShieldXmarkIcon,
} from "@/components/ui/icons";

import { TraceConnector } from "../TraceConnector";
import { TraceStep } from "../TraceStep";

import type { ToolDecision } from "../Trace";
import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
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

const scopedApprovalLabel = (covers: unknown): string => {
  if (covers === "turn") {
    return t({
      id: "trace.tool.decision.allowedForTurn",
      message: "You allowed this for this response",
    });
  }
  if (covers === "document") {
    return t({
      id: "trace.tool.decision.allowedForDocument",
      message: "You allowed this for this document",
    });
  }
  // A scope a later version records.
  return t({ id: "trace.tool.decision.allowed", message: "You allowed this" });
};

const decisionLine = (
  part: ToolUse,
  decision: ToolDecision | undefined,
): DecisionLine | undefined => {
  if (decision?.status === "approved") {
    const icon = <ShieldCheckIcon className={ICON_CLASS} />;
    if (decision.covers != null) {
      return { icon, label: scopedApprovalLabel(decision.covers) };
    }
    return decision.alwaysAllow
      ? {
          icon,
          label: t({
            id: "trace.tool.decision.alwaysAllowed",
            message: "You chose “Always allow”",
          }),
        }
      : {
          icon,
          label: t({
            id: "trace.tool.decision.allowedOnce",
            message: "You allowed this once",
          }),
        };
  }
  if (decision?.status === "denied") {
    const icon = <ShieldXmarkIcon className={ICON_CLASS} />;
    if (decision.withdrawn) {
      return {
        icon,
        label: t({
          id: "trace.tool.decision.withdrawn",
          message: "Not run: you no longer allow this tool",
        }),
      };
    }
    return decision.neverAllow
      ? {
          icon,
          label: t({
            id: "trace.tool.decision.neverAllowed",
            message: "You chose “Never allow”",
          }),
        }
      : {
          icon,
          label: t({
            id: "trace.tool.decision.denied",
            message: "You denied this",
          }),
        };
  }
  if (refusedWithoutDecision(part, decision)) {
    return {
      icon: <ShieldXmarkIcon className={ICON_CLASS} />,
      label: t({ id: "trace.tool.decision.notRun", message: "Not run" }),
    };
  }
  if (part.allowed_by === "always_allow") {
    return {
      icon: <ShieldCheckIcon className={ICON_CLASS} />,
      label: t({
        id: "trace.tool.decision.underAlwaysAllow",
        message: "Ran under your earlier “Always allow”",
      }),
    };
  }
  // Said of writes only: a read the policy lets through is the expected case.
  if (
    part.allowed_by === "policy" &&
    part.display != null &&
    part.display.read_only !== true
  ) {
    return {
      icon: <ShieldIcon className={ICON_CLASS} />,
      label: t({
        id: "trace.tool.decision.ranWithoutAsking",
        message: "Ran without asking",
      }),
    };
  }
  return undefined;
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
