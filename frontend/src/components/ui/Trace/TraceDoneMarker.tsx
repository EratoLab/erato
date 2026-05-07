import { t } from "@lingui/core/macro";

import { CheckCircleIcon } from "@/components/ui/icons";

import { TraceRailIcon } from "./TraceRailIcon";

/**
 * Closing marker for a completed trace. Renders the standard rail-icon column
 * with a checkmark and a plain "Done" label — no toggle, no body. Appears
 * only on completed traces, terminating the connecting line.
 */
export const TraceDoneMarker = () => (
  <div className="flex flex-row">
    <TraceRailIcon
      icon={<CheckCircleIcon className="size-4" />}
      hasTrailingLine={false}
    />
    <div className="min-w-0 flex-1 pl-2.5 pt-0.5 text-sm text-theme-fg-secondary">
      {t`Done`}
    </div>
  </div>
);
