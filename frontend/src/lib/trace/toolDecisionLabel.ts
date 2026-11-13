import { t } from "@lingui/core/macro";

import type { ToolDecision } from "@/components/ui/Trace/Trace";
import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/** Which way a tool call's decision went, for its icon. */
export type ToolDecisionTone = "allowed" | "denied" | "policy";

export interface ToolDecisionLabel {
  tone: ToolDecisionTone;
  label: string;
}

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

/**
 * Who allowed a tool call, or that it did not run. `refused` is a refusal
 * no card answered, e.g. a saved "Never allow". Old rows carry neither a
 * decision nor `allowed_by` and get none.
 */
export const toolDecisionLabel = (
  part: ToolUse,
  decision: ToolDecision | undefined,
  refused: boolean,
): ToolDecisionLabel | undefined => {
  if (decision?.status === "approved") {
    if (decision.covers != null) {
      return { tone: "allowed", label: scopedApprovalLabel(decision.covers) };
    }
    return {
      tone: "allowed",
      label: decision.alwaysAllow
        ? t({
            id: "trace.tool.decision.alwaysAllowed",
            message: "You chose “Always allow”",
          })
        : t({
            id: "trace.tool.decision.allowedOnce",
            message: "You allowed this once",
          }),
    };
  }
  if (decision?.status === "denied") {
    if (decision.withdrawn) {
      return {
        tone: "denied",
        label: t({
          id: "trace.tool.decision.withdrawn",
          message: "Not run: you no longer allow this tool",
        }),
      };
    }
    return {
      tone: "denied",
      label: decision.neverAllow
        ? t({
            id: "trace.tool.decision.neverAllowed",
            message: "You chose “Never allow”",
          })
        : t({
            id: "trace.tool.decision.denied",
            message: "You denied this",
          }),
    };
  }
  if (refused) {
    return {
      tone: "denied",
      label: t({ id: "trace.tool.decision.notRun", message: "Not run" }),
    };
  }
  if (part.allowed_by === "always_allow") {
    return {
      tone: "allowed",
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
      tone: "policy",
      label: t({
        id: "trace.tool.decision.ranWithoutAsking",
        message: "Ran without asking",
      }),
    };
  }
  return undefined;
};
