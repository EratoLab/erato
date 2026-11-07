import { t } from "@lingui/core/macro";

import type { ScheduledItemStatus } from "./ScheduledStatusPill";

/**
 * The view model the Scheduled page renders. It is the page's own shape, not
 * the API's: the scheduled items API (ERMAIN-1137) is mapped onto it in
 * `useScheduledItems`, so the components below never see a wire type.
 */
export type ScheduledItemType = "reminder" | "scheduled_task";

/** Where a reminder arrives. Teams chat is the only channel so far. */
export type ScheduledItemChannel = "teams_chat";

export interface ScheduledItem {
  id: string;
  type: ScheduledItemType;
  /** List entry, and the title when it arrives. */
  name: string;
  /** The body of what arrives. */
  message?: string | null;
  status: ScheduledItemStatus;
  /**
   * ISO timestamp: when it happens (upcoming), when it was carried out or
   * failed (past), or when it was due (cancelled). A snoozed item carries the
   * time it is snoozed to.
   */
  dueAt: string;
  channel?: ScheduledItemChannel | null;
  linkedChat?: { id: string; title: string } | null;
  /** Why a failed item failed, in the user's language. */
  failureReason?: string | null;
}

export interface ScheduledTemplate {
  id: string;
  type: ScheduledItemType;
  title: string;
  description: string;
}

export type ScheduledTab = "upcoming" | "past";

export function scheduledItemTab(item: ScheduledItem): ScheduledTab {
  return item.status === "scheduled" || item.status === "snoozed"
    ? "upcoming"
    : "past";
}

export function scheduledTypeLabel(type: ScheduledItemType): string {
  switch (type) {
    case "reminder":
      return t({ id: "scheduled.type.reminder", message: "Reminder" });
    case "scheduled_task":
      return t({
        id: "scheduled.type.scheduledTask",
        message: "Scheduled task",
      });
  }
}

const CHANNEL_LABEL: Record<ScheduledItemChannel, () => string> = {
  teams_chat: () =>
    t({ id: "scheduled.channel.teamsChat", message: "Teams chat" }),
};

export function scheduledChannelLabel(channel: ScheduledItemChannel): string {
  return CHANNEL_LABEL[channel]();
}

export interface ScheduledDateFormat {
  /** BCP 47 tag for day and time labels. */
  locale: string | undefined;
  /**
   * IANA zone the days are cut in and the times shown in; the browser's zone
   * when omitted. The user's stored zone goes here once it exists (ERMAIN-1111).
   */
  timeZone?: string;
}

export interface ScheduledDateContext extends ScheduledDateFormat {
  now: Date;
}

/** "Mon, 9 Nov, 08:30" in the given locale and zone. */
export function formatScheduledDateTime(
  iso: string,
  { locale, timeZone }: ScheduledDateFormat,
): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit", // eslint-disable-line lingui/no-unlocalized-strings
    minute: "2-digit", // eslint-disable-line lingui/no-unlocalized-strings
    timeZone,
  }).format(new Date(iso));
}

// en-CA formats a date as YYYY-MM-DD, which doubles as a sortable day key.
// eslint-disable-next-line lingui/no-unlocalized-strings -- format locale, not copy
const DAY_KEY_LOCALE = "en-CA";

const dayKey = (date: Date, timeZone: string | undefined) =>
  new Intl.DateTimeFormat(DAY_KEY_LOCALE, {
    year: "numeric",
    month: "2-digit", // eslint-disable-line lingui/no-unlocalized-strings
    day: "2-digit", // eslint-disable-line lingui/no-unlocalized-strings
    timeZone,
  }).format(date);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const daysBetween = (fromKey: string, toKey: string) =>
  Math.round((Date.parse(toKey) - Date.parse(fromKey)) / MS_PER_DAY);

/** Days ahead (upcoming) or back (past) that get their own dated group. */
const DATED_GROUP_DAYS = 7;

export interface ScheduledDayGroup {
  key: string;
  label: string;
  items: ScheduledItem[];
}

/**
 * Groups one tab's items by calendar day in the user's zone, nearest day
 * first: today, tomorrow or yesterday by name, the rest of the week by date,
 * and everything further out in one "Later" or "Earlier" group.
 */
export function groupScheduledItemsByDay(
  items: ScheduledItem[],
  tab: ScheduledTab,
  context: ScheduledDateContext,
): ScheduledDayGroup[] {
  const { now, locale, timeZone } = context;
  const todayKey = dayKey(now, timeZone);
  const direction = tab === "upcoming" ? 1 : -1;
  const dayLabel = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  });

  const sorted = [...items].sort(
    (left, right) =>
      direction * (Date.parse(left.dueAt) - Date.parse(right.dueAt)),
  );

  const groups: ScheduledDayGroup[] = [];
  const byKey = new Map<string, ScheduledDayGroup>();
  const beyond: ScheduledItem[] = [];

  for (const item of sorted) {
    const due = new Date(item.dueAt);
    const key = dayKey(due, timeZone);
    // An overdue upcoming item or a past one dated ahead still belongs on
    // today's group rather than out of order at the far end.
    const distance = Math.max(0, direction * daysBetween(todayKey, key));
    if (distance >= DATED_GROUP_DAYS) {
      beyond.push(item);
      continue;
    }
    const groupKey = distance === 0 ? todayKey : key;
    let group = byKey.get(groupKey);
    if (!group) {
      group = {
        key: groupKey,
        label: relativeDayLabel(distance, direction) ?? dayLabel.format(due),
        items: [],
      };
      byKey.set(groupKey, group);
      groups.push(group);
    }
    group.items.push(item);
  }

  if (beyond.length > 0) {
    groups.push({
      key: tab === "upcoming" ? "later" : "earlier",
      label:
        tab === "upcoming"
          ? t({ id: "scheduled.group.later", message: "Later" })
          : t({ id: "scheduled.group.earlier", message: "Earlier" }),
      items: beyond,
    });
  }

  return groups;
}

function relativeDayLabel(distance: number, direction: 1 | -1) {
  if (distance === 0) {
    return t({ id: "scheduled.group.today", message: "Today" });
  }
  if (distance === 1) {
    return direction === 1
      ? t({ id: "scheduled.group.tomorrow", message: "Tomorrow" })
      : t({ id: "scheduled.group.yesterday", message: "Yesterday" });
  }
  return null;
}
