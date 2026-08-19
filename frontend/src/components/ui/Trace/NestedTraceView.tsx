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

/**
 * Localized labels for the known step statuses, matching the tool step's
 * status vocabulary; unknown tokens render raw, so a newer producer is never
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

const rawCountLabel = (key: string, value: number): string =>
  `${key}: ${String(value)}`;

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
function stepDetails(
  step: SidecarLocalTraceStep,
  countLabel: (key: string, value: number) => string,
): string[] {
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

export interface NestedTraceViewProps {
  trace: SidecarLocalTrace;
  /** Phrases the computed step summary as the trace's own headline. */
  headline: (summary: string) => string;
  /** Human label for a step id; unknown ids must render verbatim. */
  stepLabel?: (id: string) => string;
  /** Human label for one `counts` entry. */
  countLabel?: (key: string, value: number) => string;
  testId: string;
  /** Headline only — for places where a full rail does not fit. */
  compact?: boolean;
}

/**
 * The steps of one nested run — a sidecar's on-device work, a delegate's
 * turn — rendered with the trace's own rail vocabulary so they read like the
 * steps around them. Unknown step ids, statuses, and count keys render by
 * their raw value, so a newer producer never renders blank against an older
 * client.
 */
export const NestedTraceView = ({
  trace,
  headline,
  stepLabel = (id) => id,
  countLabel = rawCountLabel,
  testId,
  compact = false,
}: NestedTraceViewProps) => {
  const rows = sidecarTraceRows(trace);
  if (rows.length === 0) {
    return null;
  }
  const steps = rows.map((row) => row.step);
  const model = steps.find((step) => typeof step.model === "string")?.model;
  const total = formatStepDuration(trace.totalDurationMs);
  const stepCount = steps.length;
  const summary = [
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
      <p className="text-xs text-theme-fg-muted" data-testid={testId}>
        {headline(summary)}
      </p>
    );
  }

  return (
    <div data-testid={testId}>
      <p className="py-1 pl-2.5 text-xs text-theme-fg-muted">
        {headline(summary)}
      </p>
      {rows.map(({ step, depth }, index) => {
        const titleMeta = stepTitleMeta(step);
        const details = stepDetails(step, countLabel);
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
