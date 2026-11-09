import { useId } from "react";

import { ScheduledItemRow } from "./ScheduledItemRow";
import { ListGroupHeading } from "../Container/ListGroupHeading";

import type { ScheduledItemActions } from "./ScheduledItemRow";
import type { ScheduledDateFormat, ScheduledDayGroup } from "./scheduledItems";

interface ScheduledItemGroupsProps extends ScheduledItemActions {
  groups: ScheduledDayGroup[];
  dateContext: ScheduledDateFormat;
  /** Reference time for the rows; the current time when omitted. */
  now?: Date;
  /** What the deployment's Teams app is called; null when unknown. */
  teamsAppName?: string | null;
}

/** One tab's items, a labelled section per day. */
export function ScheduledItemGroups({
  groups,
  dateContext,
  now,
  teamsAppName = null,
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
            <ListGroupHeading id={headingId} variant="overline">
              {group.label}
            </ListGroupHeading>
            <div className="grid gap-3">
              {group.items.map((item) => (
                <ScheduledItemRow
                  key={item.id}
                  item={item}
                  dateContext={dateContext}
                  now={now}
                  teamsAppName={teamsAppName}
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
