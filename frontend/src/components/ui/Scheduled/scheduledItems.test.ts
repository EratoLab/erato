import { describe, expect, it } from "vitest";

import {
  formatScheduledDateTime,
  groupScheduledItemsByDay,
  scheduledItemTab,
} from "./scheduledItems";

import type { ScheduledItemStatus } from "./ScheduledStatusPill";
import type { ScheduledItem } from "./scheduledItems";

const item = (
  id: string,
  dueAt: string,
  status: ScheduledItemStatus = "scheduled",
): ScheduledItem => ({
  id,
  type: "reminder",
  name: id,
  status,
  dueAt,
  channel: "teams_chat",
});

// Saturday, 7 November 2026, 13:00 in Berlin.
const context = {
  now: new Date("2026-11-07T12:00:00Z"),
  locale: "en-GB",
  timeZone: "Europe/Berlin",
};

const shape = (groups: ReturnType<typeof groupScheduledItemsByDay>) =>
  groups.map((group) => [group.label, group.items.map((entry) => entry.id)]);

describe("scheduledItemTab", () => {
  it("keeps scheduled and snoozed items upcoming and the rest past", () => {
    const tabs = (
      ["scheduled", "snoozed", "done", "failed", "cancelled"] as const
    ).map((status) =>
      scheduledItemTab(item(status, context.now.toISOString(), status)),
    );

    expect(tabs).toEqual(["upcoming", "upcoming", "past", "past", "past"]);
  });
});

describe("groupScheduledItemsByDay", () => {
  it("groups upcoming items by day, nearest first, and gathers the far ones under Later", () => {
    const groups = groupScheduledItemsByDay(
      [
        item("in-16-days", "2026-11-23T08:00:00Z"),
        item("monday-late", "2026-11-09T09:00:00Z"),
        item("tonight", "2026-11-07T18:00:00Z"),
        item("monday-early", "2026-11-09T07:30:00Z"),
        item("tomorrow", "2026-11-08T08:00:00Z"),
      ],
      "upcoming",
      context,
    );

    expect(shape(groups)).toEqual([
      ["Today", ["tonight"]],
      ["Tomorrow", ["tomorrow"]],
      ["Monday 9 November", ["monday-early", "monday-late"]],
      ["Later", ["in-16-days"]],
    ]);
  });

  it("groups past items by day, latest first, and gathers the old ones under Earlier", () => {
    const groups = groupScheduledItemsByDay(
      [
        item("last-month", "2026-10-01T08:00:00Z", "done"),
        item("tuesday", "2026-11-03T08:00:00Z", "failed"),
        item("yesterday", "2026-11-06T13:00:00Z", "done"),
        item("this-morning", "2026-11-07T07:00:00Z", "cancelled"),
      ],
      "past",
      context,
    );

    expect(shape(groups)).toEqual([
      ["Today", ["this-morning"]],
      ["Yesterday", ["yesterday"]],
      ["Tuesday 3 November", ["tuesday"]],
      ["Earlier", ["last-month"]],
    ]);
  });

  it("cuts the days in the user's zone, not in UTC", () => {
    // 23:30 UTC on the 7th is already the 8th in Berlin.
    const late = item("late", "2026-11-07T23:30:00Z");

    expect(
      shape(groupScheduledItemsByDay([late], "upcoming", context)),
    ).toEqual([["Tomorrow", ["late"]]]);
    expect(
      shape(
        groupScheduledItemsByDay([late], "upcoming", {
          ...context,
          timeZone: "UTC",
        }),
      ),
    ).toEqual([["Today", ["late"]]]);
  });

  it("keeps an overdue upcoming item on today rather than at the far end", () => {
    const groups = groupScheduledItemsByDay(
      [
        item("overdue", "2026-11-06T08:00:00Z"),
        item("tomorrow", "2026-11-08T08:00:00Z"),
      ],
      "upcoming",
      context,
    );

    expect(shape(groups)).toEqual([
      ["Today", ["overdue"]],
      ["Tomorrow", ["tomorrow"]],
    ]);
  });
});

describe("formatScheduledDateTime", () => {
  const sundayMorning = "2026-11-08T08:00:00Z";

  it("writes a 12-hour clock's hour without a leading zero", () => {
    expect(
      formatScheduledDateTime(sundayMorning, {
        locale: "en-US",
        timeZone: "Europe/Berlin",
      }),
    ).toBe("Sun, Nov 8, 9:00 AM");
  });

  it("keeps a 24-hour clock's hour at two digits", () => {
    expect(
      formatScheduledDateTime(sundayMorning, {
        locale: "de",
        timeZone: "Europe/Berlin",
      }),
    ).toBe("So., 8. Nov., 09:00");
  });
});
