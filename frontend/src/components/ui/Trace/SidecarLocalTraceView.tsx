import { plural, t } from "@lingui/core/macro";

import {
  isSidecarStepRunning,
  sidecarTraceRows,
} from "@/lib/desktopSidecar/traceEvents";

import { TraceStep } from "./TraceStep";
import { formatStepDuration } from "./hooks/useThinkingDuration";
import { railIconForSidecarStatus } from "./icons";

import type {
  SidecarLocalTrace,
  SidecarLocalTraceStep,
} from "@erato/desktop-sidecar-protocol";

const stepLabel = (id: string): string => {
  switch (id) {
    case "buildIndex":
      return t`Read local mailbox`;
    case "expandQuery":
      return t`Expand query on device`;
    case "match":
      return t`Match messages and attachments`;
    case "summarize":
      return t`Summarize on device`;
    case "delay":
      return t`Diagnostic delay`;
    case "cancelled":
      return t`Cancelled`;
    default:
      // Unknown steps render by their raw id, so a newer sidecar is never blank.
      return id;
  }
};

const countLabel = (key: string, value: number): string => {
  switch (key) {
    case "messagesScanned":
      return t`${value} messages`;
    case "keywordsIn":
      return t`${value} terms in`;
    case "keywordsOut":
      return t`${value} terms out`;
    case "matched":
      return t`${value} matched`;
    case "hitsReturned":
      return t`${value} returned`;
    default:
      return `${key}: ${String(value)}`;
  }
};

/**
 * Localized labels for the known step statuses, matching the tool step's
 * status vocabulary; unknown tokens render raw, so a newer sidecar is never
 * blank.
 */
const statusLabel = (status: string): string => {
  switch (status) {
    case "running":
      return t({ id: "trace.tool.running", message: "Running" });
    case "error":
      return t({ id: "trace.tool.failed", message: "Failed" });
    case "degraded":
      return t`Degraded`;
    case "skipped":
      return t`Skipped`;
    default:
      return status;
  }
};

/** Short always-visible summary next to the step title, main-line style. */
function stepTitleMeta(step: SidecarLocalTraceStep): string {
  return [step.model, formatStepDuration(step.durationMs)]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

/**
 * The step's own details, revealed by toggling the step open — the nested
 * counterpart of a main-line step's body sections.
 */
function stepDetails(step: SidecarLocalTraceStep): string[] {
  const counts = Object.entries(step.counts ?? {}).map(([key, value]) =>
    typeof value === "number"
      ? countLabel(key, value)
      : `${key}: ${String(value)}`,
  );
  return [
    step.status === "ok" ? null : statusLabel(step.status),
    step.cacheHit === true ? t`from cache` : null,
    ...counts,
    step.detail,
  ].filter((part): part is string => Boolean(part));
}

export interface SidecarLocalTraceViewProps {
  trace: SidecarLocalTrace;
  /** Headline only — for places where a full rail does not fit (consent card). */
  compact?: boolean;
}

/**
 * The steps a desktop sidecar ran on the device for one tool call, rendered
 * with the trace's own rail vocabulary so a nested local trace reads like the
 * steps around it. Unknown step ids, statuses, and count keys render by their
 * raw value, so a newer sidecar never renders blank against an older client.
 */
export const SidecarLocalTraceView = ({
  trace,
  compact = false,
}: SidecarLocalTraceViewProps) => {
  const rows = sidecarTraceRows(trace);
  if (rows.length === 0) {
    return null;
  }
  const steps = rows.map((row) => row.step);
  const model = steps.find((step) => typeof step.model === "string")?.model;
  const total = formatStepDuration(trace.totalDurationMs);
  const stepCount = steps.length;
  const headline = [
    plural(stepCount, {
      one: "# step",
      other: "# steps",
    }),
    model,
    total,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");

  if (compact) {
    return (
      <p className="text-xs text-theme-fg-muted" data-testid="sidecar-trace">
        {t`On this device: ${headline}`}
      </p>
    );
  }

  return (
    <div data-testid="sidecar-trace">
      <p className="py-1 pl-2.5 text-xs text-theme-fg-muted">
        {t`On this device: ${headline}`}
      </p>
      {rows.map(({ step, depth }, index) => {
        const titleMeta = stepTitleMeta(step);
        const details = stepDetails(step);
        return (
          <div
            key={step.sequence}
            style={
              depth > 0 ? { paddingLeft: `${depth * 0.75}rem` } : undefined
            }
          >
            <TraceStep
              railIcon={railIconForSidecarStatus(step.status)}
              hasTrailingRailLine={index < rows.length - 1}
              title={stepLabel(step.id)}
              titleSlot={
                titleMeta !== "" ? (
                  <span className="shrink-0 text-xs text-theme-fg-muted">
                    {titleMeta}
                  </span>
                ) : undefined
              }
              isActive={isSidecarStepRunning(step.status)}
            >
              {details.length > 0 ? (
                <ul className="space-y-0.5 pb-1 text-xs text-theme-fg-muted">
                  {details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              ) : undefined}
            </TraceStep>
          </div>
        );
      })}
    </div>
  );
};
