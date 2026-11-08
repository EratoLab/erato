import { plural, t } from "@lingui/core/macro";

import { formatScheduledDateTime } from "./scheduledItems";
import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";

import type { ScheduledDateFormat, ScheduledItem } from "./scheduledItems";

interface ScheduledFailureAlertProps {
  failedItems: ScheduledItem[];
  dateContext: ScheduledDateFormat;
  /** Omitted on the Past tab, where the failed rows already show. */
  onShowPast?: () => void;
  onDismiss: () => void;
}

/**
 * Failed items above the list. Page-level copy, so it names neither the item
 * type nor the channel; the row's meta line carries both.
 */
export function ScheduledFailureAlert({
  failedItems,
  dateContext,
  onShowPast,
  onDismiss,
}: ScheduledFailureAlertProps) {
  if (failedItems.length === 0) return null;

  const count = failedItems.length;
  const [first] = failedItems;
  const name = first.name;
  const when = formatScheduledDateTime(first.dueAt, dateContext);

  return (
    <Alert
      type="error"
      title={t({
        id: "scheduled.failure.title",
        message: plural(count, {
          one: "# item could not be carried out",
          other: "# items could not be carried out",
        }),
      })}
      dismissible
      onDismiss={onDismiss}
      data-testid="scheduled-failure-alert"
      action={
        onShowPast ? (
          <Button variant="secondary" size="sm" onClick={onShowPast}>
            {t({ id: "scheduled.failure.showPast", message: "Show in Past" })}
          </Button>
        ) : undefined
      }
    >
      {count === 1
        ? t({
            id: "scheduled.failure.one",
            message: `“${name}” was due ${when} and could not be carried out.`,
          })
        : t({
            id: "scheduled.failure.manyUnderPast",
            message: "They are listed under Past.",
          })}
    </Alert>
  );
}
