import { t } from "@lingui/core/macro";
import clsx from "clsx";

import type { ToolApprovalStatus } from "../Trace";
import type { TraceStepStatus } from "../types";

// Pills are only shown for states that need extra emphasis beyond the rail
// icon: in-flight (animated) and failed (red attention). The success state is
// already conveyed by the rail's checkmark — no pill needed.
const STATUS_PILL_CLASS = {
  running: "bg-theme-info-bg text-theme-info-fg animate-pulse",
  error: "bg-theme-error-bg text-theme-error-fg",
} as const;

const STATUS_LABEL = {
  running: () => t({ id: "trace.tool.running", message: "Running" }),
  error: () => t({ id: "trace.tool.failed", message: "Failed" }),
} as const;

const APPROVAL_PILL = {
  approved: {
    className: "bg-theme-success-bg text-theme-success-fg",
    label: () => t({ id: "trace.tool.approved", message: "Approved" }),
  },
  denied: {
    className: "bg-theme-error-bg text-theme-error-fg",
    label: () => t({ id: "trace.tool.denied", message: "Denied" }),
  },
} as const;

type StatusWithPill = keyof typeof STATUS_PILL_CLASS;
const hasPill = (status: TraceStepStatus): status is StatusWithPill =>
  status === "running" || status === "error";

interface ToolStatusPillProps {
  status: TraceStepStatus;
  /** Wins over the step status: the decision is the news. */
  approvalStatus?: ToolApprovalStatus;
  /** Says the outcome in the step's own words; the styling stays shared. */
  label?: string;
}

// eslint-disable-next-line lingui/no-unlocalized-strings -- utility classes
const PILL_CLASS = "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium";

/** The pill next to a tool step's title, or nothing when the rail says it. */
export const ToolStatusPill = ({
  status,
  approvalStatus,
  label,
}: ToolStatusPillProps) => {
  if (approvalStatus) {
    return (
      <span
        className={clsx(PILL_CLASS, APPROVAL_PILL[approvalStatus].className)}
      >
        {APPROVAL_PILL[approvalStatus].label()}
      </span>
    );
  }
  if (hasPill(status)) {
    return (
      <span className={clsx(PILL_CLASS, STATUS_PILL_CLASS[status])}>
        {label ?? STATUS_LABEL[status]()}
      </span>
    );
  }
  return null;
};
