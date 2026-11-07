import { useCallback, useState } from "react";

import {
  createScheduledItemFixtures,
  SCHEDULED_TEMPLATE_FIXTURES,
} from "@/components/ui/Scheduled/scheduledFixtures";

import type {
  ScheduledItem,
  ScheduledTemplate,
} from "@/components/ui/Scheduled/scheduledItems";

export interface ScheduledItemsState {
  items: ScheduledItem[];
  isLoading: boolean;
  error: Error | null;
  snooze: (item: ScheduledItem) => void;
  cancel: (item: ScheduledItem) => void;
}

/** Tomorrow at 09:00 in the browser's zone. */
const tomorrowMorning = (now: Date) => {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return next.toISOString();
};

/**
 * The user's scheduled items for the Scheduled page.
 *
 * Sample data for now: the scheduled items API (ERMAIN-1137) is not wired yet.
 * When it is, this hook maps the generated client's list response onto
 * `ScheduledItem` (delivery states pending and claimed read as `scheduled`,
 * delivered as `done`) and snooze and cancel call the API; the page and its
 * components stay as they are.
 */
export function useScheduledItems(): ScheduledItemsState {
  const [items, setItems] = useState(() =>
    createScheduledItemFixtures(new Date()),
  );

  const snooze = useCallback((target: ScheduledItem) => {
    setItems((current) =>
      current.map((item) =>
        item.id === target.id
          ? {
              ...item,
              status: "snoozed",
              dueAt: tomorrowMorning(new Date()),
            }
          : item,
      ),
    );
  }, []);

  const cancel = useCallback((target: ScheduledItem) => {
    setItems((current) =>
      current.map((item) =>
        item.id === target.id ? { ...item, status: "cancelled" } : item,
      ),
    );
  }, []);

  return { items, isLoading: false, error: null, snooze, cancel };
}

/** Templates for the empty page; sample data until ERMAIN-1141 adds the config. */
export function useScheduledTemplates(): ScheduledTemplate[] {
  return SCHEDULED_TEMPLATE_FIXTURES;
}
