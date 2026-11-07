import { t } from "@lingui/core/macro";

import { StatusPill } from "../Feedback/StatusPill";

import type { StatusPillTone } from "../Feedback/StatusPill";

/**
 * The states every scheduled item shows, whatever its type. Kept generic on
 * purpose: a reminder and a scheduled task share them, and none of them names
 * the channel it went out on.
 */
export type ScheduledItemStatus =
  | "scheduled"
  | "snoozed"
  | "done"
  | "failed"
  | "cancelled";

export const SCHEDULED_ITEM_STATUSES: readonly ScheduledItemStatus[] = [
  "scheduled",
  "snoozed",
  "done",
  "failed",
  "cancelled",
];

const STATUS_TONE: Record<ScheduledItemStatus, StatusPillTone> = {
  scheduled: "info",
  snoozed: "muted",
  done: "success",
  failed: "error",
  cancelled: "muted",
};

export function scheduledStatusTone(
  status: ScheduledItemStatus,
): StatusPillTone {
  return STATUS_TONE[status];
}

export function scheduledStatusLabel(status: ScheduledItemStatus): string {
  switch (status) {
    case "scheduled":
      return t({ id: "scheduled.status.scheduled", message: "Scheduled" });
    case "snoozed":
      return t({ id: "scheduled.status.snoozed", message: "Snoozed" });
    case "done":
      return t({ id: "scheduled.status.done", message: "Done" });
    case "failed":
      return t({ id: "scheduled.status.failed", message: "Failed" });
    case "cancelled":
      return t({ id: "scheduled.status.cancelled", message: "Cancelled" });
  }
}

export function ScheduledStatusPill({
  status,
}: {
  status: ScheduledItemStatus;
}) {
  return (
    <StatusPill tone={scheduledStatusTone(status)}>
      {scheduledStatusLabel(status)}
    </StatusPill>
  );
}
