import { describe, expect, it } from "vitest";

import { CHAT_HISTORY_FILTER_DEFAULTS } from "../store/chatHistoryFilterStore";
import { buildRecentChatsFilterParams } from "../useInfiniteRecentChats";

describe("buildRecentChatsFilterParams", () => {
  it("adds nothing for the defaults", () => {
    expect(buildRecentChatsFilterParams(CHAT_HISTORY_FILTER_DEFAULTS)).toEqual(
      {},
    );
  });

  it("maps kept sources to created_via, Teams to both Teams values", () => {
    expect(
      buildRecentChatsFilterParams({
        ...CHAT_HISTORY_FILTER_DEFAULTS,
        sourceFilter: { mode: "only", sources: ["officeAddin", "teams"] },
      }),
    ).toEqual({ created_via: "office_addin,ms_teams_tab,ms_teams_bot" });
  });

  it("maps hidden sources to exclude_created_via", () => {
    expect(
      buildRecentChatsFilterParams({
        ...CHAT_HISTORY_FILTER_DEFAULTS,
        sourceFilter: { mode: "hide", sources: ["legacy"] },
      }),
    ).toEqual({ exclude_created_via: "legacy" });
  });

  it("ignores a source filter that narrows nothing", () => {
    for (const sourceFilter of [
      { mode: "only", sources: [] },
      { mode: "all", sources: ["teams"] },
    ] as const) {
      expect(
        buildRecentChatsFilterParams({
          ...CHAT_HISTORY_FILTER_DEFAULTS,
          sourceFilter,
        }),
      ).toEqual({});
    }
  });
});
