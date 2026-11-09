import { t } from "@lingui/core/macro";

import { scheduledChannelFromApi, scheduledChannelToApi } from "./scheduledApi";
import {
  addDaysToDateKey,
  localDateKey,
  zonedWallTimeToDate,
} from "./scheduledTime";

import type { ScheduledRefusalCode } from "./scheduledApi";
import type { ScheduledItemChannel, ScheduledItemType } from "./scheduledItems";
import type {
  DayOfWeek,
  Frequency,
  RepeatEnd,
  ScheduledItem as ApiScheduledItem,
  ScheduledItemRequest,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export type ScheduledTriggerKind = "once" | "repeat";
export type ScheduledFrequency = Frequency;
export type ScheduledWeekday = DayOfWeek;
export type ScheduledEndKind = RepeatEnd["kind"];

export const SCHEDULED_WEEKDAYS: readonly ScheduledWeekday[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

/** What the form edits: strings as the inputs hold them. */
export interface ScheduledFormValues {
  name: string;
  type: ScheduledItemType;
  triggerKind: ScheduledTriggerKind;
  /** `YYYY-MM-DD`: the day of a one-off item, the first day of a repeating one. */
  date: string;
  /** `HH:MM`. */
  time: string;
  frequency: ScheduledFrequency;
  weekdays: ScheduledWeekday[];
  endKind: ScheduledEndKind;
  endDate: string;
  endCount: string;
  message: string;
  /** Empty for no linked chat. */
  linkedChatId: string;
  channel: ScheduledItemChannel;
}

export type ScheduledFormField =
  | "name"
  | "message"
  | "date"
  | "time"
  | "weekdays"
  | "endDate"
  | "endCount"
  | "linkedChatId"
  | "channel";

export type ScheduledFormErrors = Partial<Record<ScheduledFormField, string>>;

export const SCHEDULED_NAME_MAX = 200;
export const SCHEDULED_MESSAGE_MAX = 4000;
const DEFAULT_TIME = "09:00";
const DEFAULT_END_COUNT = "10";

/** `mon`…`sun` of a `YYYY-MM-DD`. */
export function weekdayOfDateKey(key: string): ScheduledWeekday {
  const [year, month, day] = key.split("-").map(Number);
  // getUTCDay counts from Sunday.
  return SCHEDULED_WEEKDAYS[
    (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
  ];
}

/** A blank form: tomorrow at 09:00 in the user's zone, delivered by chat. */
export function emptyScheduledFormValues(
  now: Date,
  timeZone: string | undefined,
): ScheduledFormValues {
  const date = addDaysToDateKey(localDateKey(now, timeZone), 1);
  return {
    name: "",
    type: "reminder",
    triggerKind: "once",
    date,
    time: DEFAULT_TIME,
    frequency: "weekly",
    weekdays: [weekdayOfDateKey(date)],
    endKind: "never",
    endDate: "",
    endCount: DEFAULT_END_COUNT,
    message: "",
    linkedChatId: "",
    // eslint-disable-next-line lingui/no-unlocalized-strings -- channel value
    channel: "teams_chat",
  };
}

/** The form for an existing item, exactly as it is stored. */
export function scheduledFormValuesFromItem(
  item: ApiScheduledItem,
  now: Date,
  timeZone: string | undefined,
): ScheduledFormValues {
  const base = emptyScheduledFormValues(now, timeZone);
  const values: ScheduledFormValues = {
    ...base,
    name: item.name,
    type: item.type,
    message: item.message,
    linkedChatId: item.linked_chat?.id ?? "",
    channel: scheduledChannelFromApi(item.channel) ?? base.channel,
  };
  const trigger = item.trigger;
  if (trigger.kind === "once") {
    return {
      ...values,
      triggerKind: "once",
      date: trigger.date,
      time: trigger.time,
    };
  }
  const ends = trigger.ends ?? { kind: "never" };
  return {
    ...values,
    triggerKind: "repeat",
    date: trigger.starts_on,
    time: trigger.time,
    frequency: trigger.frequency,
    weekdays:
      trigger.weekdays && trigger.weekdays.length > 0
        ? trigger.weekdays
        : [weekdayOfDateKey(trigger.starts_on)],
    endKind: ends.kind,
    endDate: ends.kind === "on_date" ? ends.date : "",
    endCount: ends.kind === "after_count" ? String(ends.count) : base.endCount,
  };
}

/**
 * The form for scheduling an item again: the same content and schedule
 * shape, moved so that it lies ahead. A one-off item keeps its time on the
 * next day the blank form proposes; a repeating one starts today.
 */
export function scheduledFormValuesForRepeat(
  item: ApiScheduledItem,
  now: Date,
  timeZone: string | undefined,
): ScheduledFormValues {
  const values = scheduledFormValuesFromItem(item, now, timeZone);
  const today = localDateKey(now, timeZone);
  if (values.triggerKind === "once") {
    return { ...values, date: emptyScheduledFormValues(now, timeZone).date };
  }
  const endPassed = values.endKind === "on_date" && values.endDate < today;
  return {
    ...values,
    date: today,
    endKind: endPassed ? "never" : values.endKind,
    endDate: endPassed ? "" : values.endDate,
  };
}

/** A template fills the text; the schedule stays the blank form's. */
export function scheduledFormValuesFromTemplate(
  template: { type: ScheduledItemType; name: string; message: string },
  now: Date,
  timeZone: string | undefined,
): ScheduledFormValues {
  return {
    ...emptyScheduledFormValues(now, timeZone),
    type: template.type,
    name: template.name,
    message: template.message,
  };
}

export function scheduledItemRequestBody(
  values: ScheduledFormValues,
): ScheduledItemRequest {
  const base = {
    type: values.type,
    name: values.name.trim(),
    message: values.message.trim(),
    linked_chat_id: values.linkedChatId || null,
    channel: scheduledChannelToApi(values.channel),
  };
  if (values.triggerKind === "once") {
    return {
      ...base,
      trigger: { kind: "once", date: values.date, time: values.time },
    };
  }
  /* eslint-disable lingui/no-unlocalized-strings -- wire values */
  const ends: RepeatEnd =
    values.endKind === "on_date"
      ? { kind: "on_date", date: values.endDate }
      : values.endKind === "after_count"
        ? { kind: "after_count", count: Number(values.endCount) }
        : { kind: "never" };
  /* eslint-enable lingui/no-unlocalized-strings */
  return {
    ...base,
    trigger: {
      kind: "repeat",
      frequency: values.frequency,
      time: values.time,
      starts_on: values.date,
      weekdays: values.frequency === "weekly" ? values.weekdays : [],
      ends,
    },
  };
}

/** Whether two form states describe the same schedule, as the API compares it. */
export function scheduledTriggerUnchanged(
  values: ScheduledFormValues,
  initial: ScheduledFormValues,
): boolean {
  const trigger = (form: ScheduledFormValues) => {
    const { trigger } = scheduledItemRequestBody(form);
    return trigger.kind === "repeat"
      ? {
          ...trigger,
          weekdays: SCHEDULED_WEEKDAYS.filter((day) =>
            trigger.weekdays?.includes(day),
          ),
        }
      : trigger;
  };
  return JSON.stringify(trigger(values)) === JSON.stringify(trigger(initial));
}

/**
 * Field errors before anything is sent; empty when the form can go. With
 * `unchangedFrom` (edit), a schedule left as loaded skips the time-ahead
 * check: the API keeps its coming occurrence, which a snooze may have moved
 * past a trigger time that is already over.
 */
export function validateScheduledForm(
  values: ScheduledFormValues,
  now: Date,
  timeZone: string | undefined,
  unchangedFrom?: ScheduledFormValues,
): ScheduledFormErrors {
  const errors: ScheduledFormErrors = {};
  if (!values.name.trim()) {
    errors.name = t({
      id: "scheduled.form.validation.name.required",
      message: "Enter a name.",
    });
  } else if (values.name.trim().length > SCHEDULED_NAME_MAX) {
    errors.name = t({
      id: "scheduled.form.validation.name.tooLong",
      message: `Use at most ${SCHEDULED_NAME_MAX} characters.`,
    });
  }
  if (!values.message.trim()) {
    errors.message = t({
      id: "scheduled.form.validation.message.required",
      message: "Enter the message you want to receive.",
    });
  } else if (values.message.trim().length > SCHEDULED_MESSAGE_MAX) {
    errors.message = t({
      id: "scheduled.form.validation.message.tooLong",
      message: `Use at most ${SCHEDULED_MESSAGE_MAX} characters.`,
    });
  }
  if (!values.date) {
    errors.date = t({
      id: "scheduled.form.validation.date.required",
      message: "Pick a date.",
    });
  }
  if (!values.time) {
    errors.time = t({
      id: "scheduled.form.validation.time.required",
      message: "Pick a time.",
    });
  }
  if (values.triggerKind === "repeat") {
    if (values.frequency === "weekly" && values.weekdays.length === 0) {
      errors.weekdays = t({
        id: "scheduled.form.validation.weekdays.required",
        message: "Pick at least one day.",
      });
    }
    if (values.endKind === "on_date") {
      if (!values.endDate) {
        errors.endDate = t({
          id: "scheduled.form.validation.endDate.required",
          message: "Pick the last day.",
        });
      } else if (values.date && values.endDate < values.date) {
        errors.endDate = t({
          id: "scheduled.form.validation.endDate.beforeStart",
          message: "The last day can't be before the first.",
        });
      }
    }
    if (values.endKind === "after_count") {
      const count = Number(values.endCount);
      if (!Number.isInteger(count) || count < 1) {
        errors.endCount = t({
          id: "scheduled.form.validation.endCount.invalid",
          message: "Enter a whole number of at least 1.",
        });
      }
    }
  }
  const complete =
    !errors.date &&
    !errors.time &&
    !errors.weekdays &&
    !errors.endDate &&
    !errors.endCount;
  if (
    complete &&
    !(unchangedFrom && scheduledTriggerUnchanged(values, unchangedFrom)) &&
    scheduledFirstOccurrence(values, now, timeZone) === null
  ) {
    errors.date =
      values.triggerKind === "once"
        ? t({
            id: "scheduled.form.validation.date.past",
            message: "This time is in the past. Pick a time in the future.",
          })
        : t({
            id: "scheduled.form.validation.repeat.noTimeAhead",
            message: "This schedule has no time in the future.",
          });
  }
  return errors;
}

const daysInMonth = (key: string) => {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

const dayOfMonth = (key: string) => Number(key.split("-")[2]);

/** Whether a repeating rule falls on `key`, the way the API's rule does. */
function repeatFallsOn(values: ScheduledFormValues, key: string): boolean {
  const weekday = weekdayOfDateKey(key);
  switch (values.frequency) {
    case "daily":
      return true;
    case "weekdays":
      return weekday !== "sat" && weekday !== "sun";
    case "weekly":
      return values.weekdays.includes(weekday);
    case "monthly":
      // A rule on the 29th to 31st takes the last day of a shorter month.
      return (
        dayOfMonth(key) === Math.min(dayOfMonth(values.date), daysInMonth(key))
      );
  }
}

/** Enough for the sparsest rule, monthly, as on the API. */
const MAX_SCAN_DAYS = 400;

/**
 * The day it first happens after `now`, or null when the schedule has no
 * time ahead (or the form is incomplete).
 */
export function scheduledFirstOccurrence(
  values: ScheduledFormValues,
  now: Date,
  timeZone: string | undefined,
): string | null {
  if (!values.date || !values.time) return null;
  if (values.triggerKind === "once") {
    return zonedWallTimeToDate(values.date, values.time, timeZone) > now
      ? values.date
      : null;
  }
  for (let offset = 0; offset < MAX_SCAN_DAYS; offset += 1) {
    const key = addDaysToDateKey(values.date, offset);
    if (
      values.endKind === "on_date" &&
      values.endDate &&
      key > values.endDate
    ) {
      return null;
    }
    if (
      repeatFallsOn(values, key) &&
      zonedWallTimeToDate(key, values.time, timeZone) > now
    ) {
      return key;
    }
  }
  return null;
}

/** Where an API refusal belongs in the form. */
export type ScheduledRefusalPlacement =
  | { field: ScheduledFormField }
  | { form: true };

/* eslint-disable lingui/no-unlocalized-strings -- field keys */
const REFUSAL_FIELD: Partial<Record<ScheduledRefusalCode, ScheduledFormField>> =
  {
    trigger_in_past: "date",
    invalid_trigger: "date",
    linked_chat_not_found: "linkedChatId",
    channel_not_set_up: "channel",
    channel_unavailable: "channel",
    channel_unknown: "channel",
  };
/* eslint-enable lingui/no-unlocalized-strings */

export function scheduledRefusalPlacement(
  code: string | null,
): ScheduledRefusalPlacement {
  const field = code ? REFUSAL_FIELD[code as ScheduledRefusalCode] : undefined;
  return field ? { field } : { form: true };
}
