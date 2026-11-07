import { useId } from "react";

import { ScheduledItemRow } from "./ScheduledItemRow";

import type { ScheduledItemActions } from "./ScheduledItemRow";
import type { ScheduledDateFormat, ScheduledDayGroup } from "./scheduledItems";

interface ScheduledItemGroupsProps extends ScheduledItemActions {
  groups: ScheduledDayGroup[];
  dateContext: ScheduledDateFormat;
  /** Reference time for the rows; the current time when omitted. */
  now?: Date;
}

/** One tab's items, a labelled section per day. */
export function ScheduledItemGroups({
  groups,
  dateContext,
  now,
  ...actions
}: ScheduledItemGroupsProps) {
  const baseId = useId();

  return (
    <div className="space-y-8" data-ui="scheduled-item-groups">
      {groups.map((group) => {
        const headingId = `${baseId}-${group.key}-heading`;
        return (
          <section
            key={group.key}
            aria-labelledby={headingId}
            data-ui="scheduled-day-group"
          >
            <h2
              id={headingId}
              className="mb-2 px-4 text-xs font-semibold uppercase tracking-wide text-theme-fg-muted"
            >
              {group.label}
            </h2>
            <div className="grid gap-3">
              {group.items.map((item) => (
                <ScheduledItemRow
                  key={item.id}
                  item={item}
                  dateContext={dateContext}
                  now={now}
                  {...actions}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
