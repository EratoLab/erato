import { i18n } from "@lingui/core";
import { beforeAll, describe, expect, it } from "vitest";

import {
  scheduledChannelStatus,
  scheduledItemFromApi,
  scheduledLimitReached,
  scheduledNoChannelConnected,
  scheduledPageNotice,
  scheduledRefusalCode,
  scheduledRefusalMessage,
} from "./scheduledApi";

import type { ScheduledItem as ApiScheduledItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const apiItem = (
  overrides: Partial<ApiScheduledItem> = {},
): ApiScheduledItem => ({
  id: "item-1",
  type: "reminder",
  name: "Follow up on the offer",
  message: "Ask whether they decided.",
  trigger: { kind: "once", date: "2026-11-13", time: "10:00" },
  time_zone: "Europe/Berlin",
  status: "scheduled",
  next_occurrence: {
    at: "2026-11-13T09:00:00Z",
    local: "2026-11-13T10:00:00",
  },
  occurrence_count: 1,
  channel: "teams_personal",
  channel_status: "connected",
  linked_chat: { id: "chat-1", title: "Offer Müller GmbH" },
  created_at: "2026-11-07T10:00:00Z",
  updated_at: "2026-11-07T10:00:00Z",
  ...overrides,
});

describe("scheduledItemFromApi", () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  it("maps an upcoming item onto the view model", () => {
    expect(scheduledItemFromApi(apiItem(), "upcoming")).toEqual({
      id: "item-1",
      type: "reminder",
      name: "Follow up on the offer",
      message: "Ask whether they decided.",
      status: "scheduled",
      dueAt: "2026-11-13T09:00:00Z",
      channel: "teams_chat",
      linkedChat: { id: "chat-1", title: "Offer Müller GmbH" },
      tab: "upcoming",
    });
  });

  it("dates a finished item by its last occurrence", () => {
    const item = scheduledItemFromApi(
      apiItem({
        status: "failed",
        next_occurrence: null,
        last_delivery: {
          due: { at: "2026-11-05T08:00:00Z", local: "2026-11-05T09:00:00" },
          outcome: "failed",
        },
        linked_chat: null,
      }),
      "past",
    );

    expect(item).toMatchObject({
      status: "failed",
      dueAt: "2026-11-05T08:00:00Z",
      linkedChat: null,
      tab: "past",
    });
  });

  it("falls back to the last change for an item that never came due", () => {
    const item = scheduledItemFromApi(
      apiItem({ status: "cancelled", next_occurrence: null }),
      "past",
    );

    expect(item.dueAt).toBe("2026-11-07T10:00:00Z");
  });
});

describe("scheduledPageNotice", () => {
  const base = { upcoming_count: 2, max_upcoming: 10 };

  it("says nothing while a channel is connected and there is room", () => {
    expect(
      scheduledPageNotice({
        ...base,
        channels: [{ channel: "teams_personal", status: "connected" }],
      }),
    ).toBeNull();
  });

  it("asks for a channel to be set up, or says none is available", () => {
    expect(
      scheduledPageNotice({
        ...base,
        channels: [{ channel: "teams_personal", status: "not_set_up" }],
      }),
    ).toEqual({ kind: "delivery_not_set_up" });
    expect(
      scheduledPageNotice({
        ...base,
        channels: [{ channel: "teams_personal", status: "unavailable" }],
      }),
    ).toEqual({ kind: "delivery_unavailable" });
  });

  it("reports the limit", () => {
    expect(
      scheduledPageNotice({
        upcoming_count: 10,
        max_upcoming: 10,
        channels: [{ channel: "teams_personal", status: "connected" }],
      }),
    ).toEqual({ kind: "limit_reached", max: 10 });
  });
});

describe("scheduledChannelStatus", () => {
  it("reads the page's channel under its API name", () => {
    expect(
      scheduledChannelStatus(
        [{ channel: "teams_personal", status: "not_set_up" }],
        "teams_chat",
      ),
    ).toBe("not_set_up");
    expect(scheduledChannelStatus([], "teams_chat")).toBe("unavailable");
  });
});

describe("refusals", () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  it("reads the code from the thrown body or the fallback wrapper", () => {
    expect(
      scheduledRefusalCode({ code: "trigger_in_past", message: "..." }),
    ).toBe("trigger_in_past");
    expect(
      scheduledRefusalCode({ status: 409, payload: { code: "finished" } }),
    ).toBe("finished");
    expect(scheduledRefusalCode(new Error("Network error"))).toBeNull();
    expect(scheduledRefusalCode(undefined)).toBeNull();
  });

  it("has a message for every code and a fallback", () => {
    expect(scheduledRefusalMessage("limit_reached")).toBe(
      "You have the maximum number of upcoming items. Cancel one first.",
    );
    expect(scheduledRefusalMessage("something_new")).toBe(
      "Something went wrong. Please try again.",
    );
  });
});

describe("scheduledLimitReached", () => {
  it("is reached at the maximum, and never without one", () => {
    expect(scheduledLimitReached(9, 10)).toBe(false);
    expect(scheduledLimitReached(10, 10)).toBe(true);
    expect(scheduledLimitReached(10, 0)).toBe(false);
    expect(scheduledLimitReached(10, undefined)).toBe(false);
  });
});

describe("scheduledNoChannelConnected", () => {
  it("holds until one channel reaches the user", () => {
    expect(
      scheduledNoChannelConnected([
        { channel: "teams_personal", status: "not_set_up" },
      ]),
    ).toBe(true);
    expect(
      scheduledNoChannelConnected([
        { channel: "teams_personal", status: "connected" },
      ]),
    ).toBe(false);
  });
});
