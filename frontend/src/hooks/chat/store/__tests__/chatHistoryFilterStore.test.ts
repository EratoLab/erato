import { beforeEach, describe, expect, it } from "vitest";

import {
  CHAT_HISTORY_FILTER_DEFAULTS,
  isDefaultFilters,
  sanitizeChatHistoryFilters,
  useChatHistoryFilterStore,
} from "../chatHistoryFilterStore";

const store = () => useChatHistoryFilterStore.getState();

describe("chatHistoryFilterStore", () => {
  beforeEach(() => {
    localStorage.clear();
    store().resetToDefaults();
  });

  it("starts with all / active / date", () => {
    expect(store()).toMatchObject(CHAT_HISTORY_FILTER_DEFAULTS);
  });

  it("updates each value independently", () => {
    store().setTypeFilter("assistant");
    store().setStatusFilter("all");
    store().setGroupBy("unread");

    expect(store()).toMatchObject({
      typeFilter: "assistant",
      statusFilter: "all",
      groupBy: "unread",
    });
  });

  it("resets to the defaults", () => {
    store().setTypeFilter("chat");
    store().setStatusFilter("all");
    store().setGroupBy("none");

    store().resetToDefaults();

    expect(store()).toMatchObject(CHAT_HISTORY_FILTER_DEFAULTS);
  });

  it("persists under the sidebar localStorage key", () => {
    store().setGroupBy("unread");

    const raw = localStorage.getItem("erato.sidebar.chatHistoryFilters");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "{}")).toMatchObject({
      state: { groupBy: "unread" },
    });
  });

  it("rehydrates from a stored value", async () => {
    localStorage.setItem(
      "erato.sidebar.chatHistoryFilters",
      JSON.stringify({
        state: { typeFilter: "chat", statusFilter: "all", groupBy: "unread" },
        version: 0,
      }),
    );

    await useChatHistoryFilterStore.persist.rehydrate();

    expect(store()).toMatchObject({
      typeFilter: "chat",
      statusFilter: "all",
      groupBy: "unread",
    });
  });

  it("coerces garbage persisted values back to the defaults", async () => {
    localStorage.setItem(
      "erato.sidebar.chatHistoryFilters",
      JSON.stringify({
        state: { typeFilter: "bogus", statusFilter: 42, groupBy: { a: 1 } },
        version: 0,
      }),
    );

    await useChatHistoryFilterStore.persist.rehydrate();

    expect(store()).toMatchObject(CHAT_HISTORY_FILTER_DEFAULTS);
  });

  it("keeps valid persisted values while coercing invalid ones", async () => {
    localStorage.setItem(
      "erato.sidebar.chatHistoryFilters",
      JSON.stringify({
        state: { typeFilter: "chat", statusFilter: "nope", groupBy: "unread" },
        version: 0,
      }),
    );

    await useChatHistoryFilterStore.persist.rehydrate();

    expect(store()).toMatchObject({
      typeFilter: "chat",
      statusFilter: "active",
      groupBy: "unread",
    });
  });

  it("survives a persisted state that is not an object", async () => {
    localStorage.setItem(
      "erato.sidebar.chatHistoryFilters",
      JSON.stringify({ state: "garbage", version: 0 }),
    );

    await useChatHistoryFilterStore.persist.rehydrate();

    expect(store()).toMatchObject(CHAT_HISTORY_FILTER_DEFAULTS);
  });
});

describe("isDefaultFilters", () => {
  it("is true only for the exact default combination", () => {
    expect(isDefaultFilters(CHAT_HISTORY_FILTER_DEFAULTS)).toBe(true);
    expect(
      isDefaultFilters({ ...CHAT_HISTORY_FILTER_DEFAULTS, typeFilter: "chat" }),
    ).toBe(false);
    expect(
      isDefaultFilters({
        ...CHAT_HISTORY_FILTER_DEFAULTS,
        statusFilter: "all",
      }),
    ).toBe(false);
    expect(
      isDefaultFilters({ ...CHAT_HISTORY_FILTER_DEFAULTS, groupBy: "none" }),
    ).toBe(false);
  });
});

describe("sanitizeChatHistoryFilters", () => {
  const assistantScoped = {
    typeFilter: "assistant",
    statusFilter: "all",
    groupBy: "type",
  } as const;

  it("passes values through when assistants are enabled", () => {
    expect(sanitizeChatHistoryFilters(assistantScoped, true)).toEqual(
      assistantScoped,
    );
  });

  it("falls assistant-scoped values back to defaults when disabled", () => {
    expect(sanitizeChatHistoryFilters(assistantScoped, false)).toEqual({
      typeFilter: "all",
      statusFilter: "all",
      groupBy: "date",
    });
  });

  it("keeps assistant-independent values when disabled", () => {
    const values = {
      typeFilter: "all",
      statusFilter: "active",
      groupBy: "unread",
    } as const;

    expect(sanitizeChatHistoryFilters(values, false)).toEqual(values);
  });
});
