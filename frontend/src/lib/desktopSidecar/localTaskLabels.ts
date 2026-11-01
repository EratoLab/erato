import { t } from "@lingui/core/macro";

import type { LocalTaskViewState } from "./localTaskCoordinator";

/** A local-evidence job's state on this device, in the user's words. */
export function localTaskLabel(state: LocalTaskViewState): string {
  switch (state) {
    case "queued":
    case "running":
      return t`Collecting evidence on this device`;
    case "ready_for_review":
      return t`Ready for review in the Erato desktop app`;
    case "approved":
      return t`Approved evidence is ready to upload`;
    case "awaiting_authenticated_resume":
    case "continuing":
    case "acknowledged":
      return t`Continuing the original task`;
    case "declined":
      return t`Sharing declined on this device`;
    case "cancelled":
      return t`Local task cancelled`;
    case "expired":
      return t`Local task expired`;
    case "failed":
      return t`Local collection could not finish`;
    case "another_device":
      return t`Waiting for the device that accepted this task`;
    case "unavailable":
      return t`Waiting for the Erato desktop app to reconnect`;
  }
}
