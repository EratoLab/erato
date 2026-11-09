import { t } from "@lingui/core/macro";

import { scheduledLimitMessage } from "./scheduledApi";
import { Alert } from "../Feedback/Alert";

import type { ScheduledPageNotice } from "./scheduledApi";

/**
 * Why nothing new can be scheduled right now. Page-level copy, so it names
 * no channel: the form's delivery settings say which one and how to set it up.
 */
export function ScheduledPageNoticeAlert({
  notice,
}: {
  notice: ScheduledPageNotice;
}) {
  switch (notice.kind) {
    case "delivery_not_set_up":
      return (
        <Alert
          type="info"
          role="status"
          data-testid="scheduled-notice"
          title={t({
            id: "scheduled.notice.notSetUp.title",
            message: "Set up delivery first",
          })}
        >
          {t({
            id: "scheduled.notice.notSetUp.body",
            message:
              "No delivery channel can reach you yet, so nothing new can be scheduled. The form's advanced settings show how to set one up.",
          })}
        </Alert>
      );
    case "delivery_unavailable":
      return (
        <Alert type="warning" role="status" data-testid="scheduled-notice">
          {t({
            id: "scheduled.notice.unavailable",
            message:
              "Delivery is not available here yet, so nothing new can be scheduled.",
          })}
        </Alert>
      );
    case "limit_reached":
      return (
        <Alert type="info" role="status" data-testid="scheduled-notice">
          {scheduledLimitMessage(notice.max)}
        </Alert>
      );
  }
}
