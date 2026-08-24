import { beforeEach, describe, expect, it } from "vitest";

import { getAddinChatHistoryFilterStore } from "../addinChatHistoryFilterStore";

describe("getAddinChatHistoryFilterStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("caches one store per platform under a platform-scoped key", () => {
    const outlook = getAddinChatHistoryFilterStore("outlook");
    expect(getAddinChatHistoryFilterStore("outlook")).toBe(outlook);

    const teams = getAddinChatHistoryFilterStore("teams");
    expect(teams).not.toBe(outlook);

    outlook.getState().setStatusFilter("all");
    expect(teams.getState().statusFilter).toBe("active");
    expect(
      localStorage.getItem("erato.addin.outlook.chatHistoryFilters.v1"),
    ).not.toBeNull();
    expect(
      localStorage.getItem("erato.addin.teams.chatHistoryFilters.v1"),
    ).toBeNull();
  });

  it("never writes the web sidebar's un-prefixed key", () => {
    const store = getAddinChatHistoryFilterStore("addin-neutral");
    store.getState().setGroupBy("none");

    expect(localStorage.getItem("erato.sidebar.chatHistoryFilters")).toBeNull();
    expect(
      localStorage.getItem("erato.addin.addin-neutral.chatHistoryFilters.v1"),
    ).not.toBeNull();
  });
});
