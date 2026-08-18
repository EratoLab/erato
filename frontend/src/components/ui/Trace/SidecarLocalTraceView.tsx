import { t } from "@lingui/core/macro";

import { NestedTraceView } from "./NestedTraceView";

import type { SidecarLocalTrace } from "@erato/desktop-sidecar-protocol";

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

const sidecarHeadline = (headline: string): string =>
  t`On this device: ${headline}`;

export interface SidecarLocalTraceViewProps {
  trace: SidecarLocalTrace;
  /** Headline only — for places where a full rail does not fit (consent card). */
  compact?: boolean;
}

/**
 * The steps a desktop sidecar ran on the device for one tool call: the shared
 * nested-trace rendering, spoken in the sidecar's vocabulary.
 */
export const SidecarLocalTraceView = ({
  trace,
  compact = false,
}: SidecarLocalTraceViewProps) => (
  <NestedTraceView
    trace={trace}
    headline={sidecarHeadline}
    stepLabel={stepLabel}
    countLabel={countLabel}
    testId="sidecar-trace"
    compact={compact}
  />
);
