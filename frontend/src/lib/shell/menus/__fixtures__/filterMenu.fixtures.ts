/* eslint-disable lingui/no-unlocalized-strings -- fixture data standing in for what a server sends */
import { CHAT_HISTORY_FILTER_DEFAULTS } from "@/hooks/chat/store/chatHistoryFilterStore";

import { everyValue } from "./everyValue";

import type {
  ChatHistoryFilterCapabilities,
  ChatHistoryFilterValues,
  ChatHistoryGroupBy,
  ChatHistorySource,
  ChatHistorySourceMode,
} from "@/hooks/chat/store/chatHistoryFilterStore";

export interface FilterMenuFixture {
  values: ChatHistoryFilterValues;
  capabilities: ChatHistoryFilterCapabilities;
}

const everything: ChatHistoryFilterCapabilities = {
  assistantsEnabled: true,
  delegationEnabled: true,
  availableSources: everyValue<ChatHistorySource>()(
    "web",
    "outlook",
    "word",
    "officeAddin",
    "teams",
    "legacy",
  ),
};

const fixture = (
  values: Partial<ChatHistoryFilterValues> = {},
  capabilities: Partial<ChatHistoryFilterCapabilities> = {},
): FilterMenuFixture => ({
  values: { ...CHAT_HISTORY_FILTER_DEFAULTS, ...values },
  capabilities: { ...everything, ...capabilities },
});

const groupings = everyValue<ChatHistoryGroupBy>()(
  "date",
  "type",
  "unread",
  "none",
);
const sourceModes = everyValue<ChatHistorySourceMode>()("all", "only", "hide");

export const FILTER_MENU_FIXTURES: Record<string, FilterMenuFixture> = {
  defaults: fixture(),
  // A deployment without assistants has no Type row, no delegation, and
  // only the web app as a source, so no Source row either.
  plain: fixture(
    {},
    {
      assistantsEnabled: false,
      delegationEnabled: false,
      availableSources: ["web", "legacy"],
    },
  ),
  assistantsWithoutDelegation: fixture({}, { delegationEnabled: false }),
  changed: fixture({
    typeFilter: "assistant",
    statusFilter: "all",
    delegatedFilter: "shown",
    groupBy: "unread",
  }),
  ...Object.fromEntries(
    groupings.map((groupBy) => [`groupBy-${groupBy}`, fixture({ groupBy })]),
  ),
  ...Object.fromEntries(
    sourceModes.map((mode) => [
      `source-${mode}`,
      fixture({
        sourceFilter: {
          mode,
          sources: mode === "all" ? [] : ["outlook", "teams"],
        },
      }),
    ]),
  ),
  oneIntegration: fixture({}, { availableSources: ["web", "outlook"] }),
};
