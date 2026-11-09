import { i18n } from "@lingui/core";
import { beforeAll, describe, expect, it } from "vitest";

import {
  emptyScheduledFormValues,
  scheduledFirstOccurrence,
  scheduledFormValuesForRepeat,
  scheduledFormValuesFromItem,
  scheduledFormValuesFromTemplate,
  scheduledItemRequestBody,
  scheduledRefusalPlacement,
  validateScheduledForm,
  weekdayOfDateKey,
} from "./scheduledForm";

import type { ScheduledFormValues } from "./scheduledForm";
import type { ScheduledItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

// Saturday, 7 November 2026, 12:00 in Berlin.
const NOW = new Date("2026-11-07T11:00:00Z");
const ZONE = "Europe/Berlin";

const item = (overrides: Partial<ScheduledItem> = {}): ScheduledItem => ({
  id: "item-1",
  type: "reminder",
  name: "Follow up on the offer",
  message: "Ask whether they decided.",
  trigger: { kind: "once", date: "2026-11-13", time: "10:00" },
  time_zone: ZONE,
  status: "scheduled",
  occurrence_count: 1,
  channel: "teams_personal",
  channel_status: "connected",
  linked_chat: { id: "chat-1", title: "Offer" },
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-01T10:00:00Z",
  ...overrides,
});

const values = (
  overrides: Partial<ScheduledFormValues> = {},
): ScheduledFormValues => ({
  ...emptyScheduledFormValues(NOW, ZONE),
  name: "Name",
  message: "Message",
  ...overrides,
});

describe("scheduledForm", () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  it("starts a blank form tomorrow at 09:00 in the user's zone", () => {
    expect(emptyScheduledFormValues(NOW, ZONE)).toMatchObject({
      triggerKind: "once",
      date: "2026-11-08",
      time: "09:00",
      weekdays: ["sun"],
      endKind: "never",
      linkedChatId: "",
      channel: "teams_chat",
    });
    expect(weekdayOfDateKey("2026-11-09")).toBe("mon");
  });

  it("sends a one-off item with the page's channel under its API name", () => {
    expect(
      scheduledItemRequestBody(
        values({ name: "  Call back ", linkedChatId: "chat-1" }),
      ),
    ).toEqual({
      type: "reminder",
      name: "Call back",
      message: "Message",
      linked_chat_id: "chat-1",
      channel: "teams_personal",
      trigger: { kind: "once", date: "2026-11-08", time: "09:00" },
    });
  });

  it("sends a repeating rule with its days and end", () => {
    const weekly = scheduledItemRequestBody(
      values({
        triggerKind: "repeat",
        frequency: "weekly",
        weekdays: ["mon", "thu"],
        date: "2026-11-09",
        endKind: "after_count",
        endCount: "8",
      }),
    );
    expect(weekly.linked_chat_id).toBeNull();
    expect(weekly.trigger).toEqual({
      kind: "repeat",
      frequency: "weekly",
      time: "09:00",
      starts_on: "2026-11-09",
      weekdays: ["mon", "thu"],
      ends: { kind: "after_count", count: 8 },
    });

    const monthly = scheduledItemRequestBody(
      values({
        triggerKind: "repeat",
        frequency: "monthly",
        weekdays: ["mon"],
        endKind: "on_date",
        endDate: "2027-06-30",
      }),
    );
    expect(monthly.trigger).toMatchObject({
      weekdays: [],
      ends: { kind: "on_date", date: "2027-06-30" },
    });
  });

  it("round-trips an item through the form", () => {
    const repeating = item({
      trigger: {
        kind: "repeat",
        frequency: "weekly",
        weekdays: ["tue"],
        time: "08:00",
        starts_on: "2026-11-10",
        ends: { kind: "on_date", date: "2026-12-22" },
      },
    });
    const formValues = scheduledFormValuesFromItem(repeating, NOW, ZONE);

    expect(scheduledItemRequestBody(formValues)).toEqual({
      type: "reminder",
      name: repeating.name,
      message: repeating.message,
      linked_chat_id: "chat-1",
      channel: "teams_personal",
      trigger: repeating.trigger,
    });
  });

  it("moves an item scheduled again so that it lies ahead", () => {
    const once = scheduledFormValuesForRepeat(
      item({ trigger: { kind: "once", date: "2026-10-01", time: "14:30" } }),
      NOW,
      ZONE,
    );
    expect(once).toMatchObject({ date: "2026-11-08", time: "14:30" });

    const repeating = scheduledFormValuesForRepeat(
      item({
        trigger: {
          kind: "repeat",
          frequency: "daily",
          time: "07:00",
          starts_on: "2026-09-01",
          ends: { kind: "on_date", date: "2026-10-01" },
        },
      }),
      NOW,
      ZONE,
    );
    expect(repeating).toMatchObject({
      date: "2026-11-07",
      endKind: "never",
      endDate: "",
    });
  });

  it("fills the text from a template and keeps the blank schedule", () => {
    expect(
      scheduledFormValuesFromTemplate(
        { type: "reminder", name: "Follow up", message: "Ask them" },
        NOW,
        ZONE,
      ),
    ).toMatchObject({
      name: "Follow up",
      message: "Ask them",
      date: "2026-11-08",
      time: "09:00",
    });
  });

  it("requires a name, a message and a time ahead", () => {
    expect(
      validateScheduledForm(
        values({ name: " ", message: "", date: "2026-11-07", time: "11:00" }),
        NOW,
        ZONE,
      ),
    ).toEqual({
      name: "Enter a name.",
      message: "Enter the message you want to receive.",
      date: "This time is in the past. Pick a time in the future.",
    });
    expect(validateScheduledForm(values(), NOW, ZONE)).toEqual({});
  });

  it("lets an edit keep a schedule whose time is over, as a snooze leaves it", () => {
    const loaded = values({ date: "2026-11-07", time: "11:00" });

    expect(
      validateScheduledForm({ ...loaded, name: "Renamed" }, NOW, ZONE, loaded),
    ).toEqual({});
    expect(
      validateScheduledForm({ ...loaded, time: "11:30" }, NOW, ZONE, loaded),
    ).toEqual({
      date: "This time is in the past. Pick a time in the future.",
    });
    expect(validateScheduledForm(loaded, NOW, ZONE)).toEqual({
      date: "This time is in the past. Pick a time in the future.",
    });
  });

  it("checks a repeating rule's days, end and whether it ever happens", () => {
    expect(
      validateScheduledForm(
        values({
          triggerKind: "repeat",
          frequency: "weekly",
          weekdays: [],
          endKind: "after_count",
          endCount: "0",
        }),
        NOW,
        ZONE,
      ),
    ).toEqual({
      weekdays: "Pick at least one day.",
      endCount: "Enter a whole number of at least 1.",
    });
    expect(
      validateScheduledForm(
        values({
          triggerKind: "repeat",
          frequency: "weekly",
          weekdays: ["mon"],
          date: "2026-11-10",
          endKind: "on_date",
          endDate: "2026-11-15",
        }),
        NOW,
        ZONE,
      ),
    ).toEqual({ date: "This schedule has no time in the future." });
  });

  it("finds the first occurrence the way the API's rule does", () => {
    const first = (overrides: Partial<ScheduledFormValues>) =>
      scheduledFirstOccurrence(
        values({ triggerKind: "repeat", ...overrides }),
        NOW,
        ZONE,
      );

    // Today 11:00 has passed at 12:00, so daily starts tomorrow.
    expect(
      first({ frequency: "daily", date: "2026-11-07", time: "11:00" }),
    ).toBe("2026-11-08");
    expect(first({ frequency: "weekdays", date: "2026-11-07" })).toBe(
      "2026-11-09",
    );
    expect(
      first({ frequency: "weekly", weekdays: ["thu"], date: "2026-11-07" }),
    ).toBe("2026-11-12");
    // A rule on the 31st takes the last day of a shorter month.
    expect(first({ frequency: "monthly", date: "2026-10-31" })).toBe(
      "2026-11-30",
    );
  });

  it("puts refusals on the field they concern", () => {
    expect(scheduledRefusalPlacement("trigger_in_past")).toEqual({
      field: "date",
    });
    expect(scheduledRefusalPlacement("channel_not_set_up")).toEqual({
      field: "channel",
    });
    expect(scheduledRefusalPlacement("linked_chat_not_found")).toEqual({
      field: "linkedChatId",
    });
    expect(scheduledRefusalPlacement("limit_reached")).toEqual({ form: true });
    expect(scheduledRefusalPlacement(null)).toEqual({ form: true });
  });
});
