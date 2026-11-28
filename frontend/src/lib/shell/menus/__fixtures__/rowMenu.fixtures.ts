/* eslint-disable lingui/no-unlocalized-strings -- fixture data standing in for what a server sends */
import { everyValue } from "@/utils/everyValue";

import type { RowMenuGates, RowMenuState } from "../describeRowMenu";
import type { ChatAttentionStatus } from "@/utils/chatHistoryGrouping";

interface RowMenuFixture {
  state: RowMenuState;
  gates: RowMenuGates;
  /** The chat's title, which the system menu shows above the entries. */
  title: string;
}

const idle: RowMenuState = {
  archived: false,
  isPinned: false,
  canEdit: true,
  isRun: false,
  status: null,
  waitingOnly: false,
};

const sidebar: RowMenuGates = {
  pinnedChatsCount: 2,
  pinnedChatsLimit: 5,
  handles: {
    pin: true,
    share: true,
    rename: true,
    archive: true,
    unarchive: true,
  },
};

const fixture = (
  state: Partial<RowMenuState> = {},
  gates: Partial<RowMenuGates> = {},
): RowMenuFixture => ({
  state: { ...idle, ...state },
  gates: { ...sidebar, ...gates },
  title: "Quarterly report draft",
});

const statuses = everyValue<ChatAttentionStatus>()(
  "running",
  "action_required",
  "finished",
  "error",
);

export const ROW_MENU_FIXTURES: Record<string, RowMenuFixture> = {
  idle: fixture(),
  ...Object.fromEntries(
    statuses.map((status) => [`status-${status}`, fixture({ status })]),
  ),
  waitingOnly: fixture({ waitingOnly: true }),
  archived: fixture({ archived: true }),
  pinned: fixture({ isPinned: true }, { pinnedChatsCount: 5 }),
  pinLimitReached: fixture({}, { pinnedChatsCount: 5 }),
  cannotEdit: fixture({ canEdit: false }),
  run: fixture({ isRun: true, status: "running" }),
  // The search page offers pin and share only where the server has them on.
  pinningAndSharingOff: fixture(
    {},
    { handles: { rename: true, archive: true, unarchive: true } },
  ),
};
