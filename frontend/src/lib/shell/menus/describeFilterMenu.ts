import { t } from "@lingui/core/macro";

import {
  CHAT_HISTORY_SOURCE_VALUES,
  DELEGATED_FILTER_VALUES,
  GROUP_BY_VALUES,
  SOURCE_MODE_VALUES,
  STATUS_FILTER_VALUES,
  TYPE_FILTER_VALUES,
  isSourceFilterActive,
  isSourceFilterAvailable,
  sanitizeChatHistoryFilters,
} from "@/hooks/chat/store/chatHistoryFilterStore";

import type { MenuEntry } from "./menuEntry";
import type {
  ChatHistoryDelegatedFilter,
  ChatHistoryFilterCapabilities,
  ChatHistoryFilterValues,
  ChatHistoryGroupBy,
  ChatHistorySource,
  ChatHistorySourceMode,
  ChatHistoryStatusFilter,
  ChatHistoryTypeFilter,
} from "@/hooks/chat/store/chatHistoryFilterStore";

/** A pick in the filter menu, as both drawings apply it. */
export type FilterMenuChoice =
  | { kind: "type"; value: ChatHistoryTypeFilter }
  | { kind: "status"; value: ChatHistoryStatusFilter }
  | { kind: "delegated"; value: ChatHistoryDelegatedFilter }
  | { kind: "groupBy"; value: ChatHistoryGroupBy }
  | { kind: "sourceMode"; value: ChatHistorySourceMode }
  | { kind: "source"; value: ChatHistorySource }
  | { kind: "reset" };

export type FilterMenuRowKey =
  | "type"
  | "status"
  | "delegated"
  | "source"
  | "groupBy";

export const FILTER_MENU_RESET_ID = "reset";
// eslint-disable-next-line lingui/no-unlocalized-strings -- entry id
const SOURCE_MODE_SECTION_ID = "sourceMode";
const SOURCES_SECTION_ID = "sources";

const choiceId = (kind: string, value: string) => `${kind}:${value}`;

/** The pick an entry id stands for, or null for an id this menu never made. */
export function filterMenuChoice(itemId: string): FilterMenuChoice | null {
  if (itemId === FILTER_MENU_RESET_ID) return { kind: "reset" };
  const parts = itemId.split(":");
  if (parts.length !== 2) return null;
  const [kind, value] = parts;
  const pick = <V extends string>(values: readonly V[]) =>
    (values as readonly string[]).includes(value) ? (value as V) : null;
  switch (kind) {
    case "type": {
      const v = pick(TYPE_FILTER_VALUES);
      return v && { kind, value: v };
    }
    case "status": {
      const v = pick(STATUS_FILTER_VALUES);
      return v && { kind, value: v };
    }
    case "delegated": {
      const v = pick(DELEGATED_FILTER_VALUES);
      return v && { kind, value: v };
    }
    case "groupBy": {
      const v = pick(GROUP_BY_VALUES);
      return v && { kind, value: v };
    }
    case "sourceMode": {
      const v = pick(SOURCE_MODE_VALUES);
      return v && { kind, value: v };
    }
    case "source": {
      const v = pick(CHAT_HISTORY_SOURCE_VALUES);
      return v && { kind, value: v };
    }
    default:
      return null;
  }
}

export interface FilterMenuSetters {
  setTypeFilter: (value: ChatHistoryTypeFilter) => void;
  setStatusFilter: (value: ChatHistoryStatusFilter) => void;
  setDelegatedFilter: (value: ChatHistoryDelegatedFilter) => void;
  setGroupBy: (value: ChatHistoryGroupBy) => void;
  setSourceMode: (value: ChatHistorySourceMode) => void;
  toggleSource: (value: ChatHistorySource) => void;
  resetToDefaults: () => void;
}

export function applyFilterMenuChoice(
  choice: FilterMenuChoice,
  setters: FilterMenuSetters,
): void {
  switch (choice.kind) {
    case "type":
      return setters.setTypeFilter(choice.value);
    case "status":
      return setters.setStatusFilter(choice.value);
    case "delegated":
      return setters.setDelegatedFilter(choice.value);
    case "groupBy":
      return setters.setGroupBy(choice.value);
    case "sourceMode":
      return setters.setSourceMode(choice.value);
    case "source":
      return setters.toggleSource(choice.value);
    case "reset":
      return setters.resetToDefaults();
  }
}

const sourceLabel = (source: ChatHistorySource): string => {
  switch (source) {
    case "web":
      return t({
        id: "chat.history.filterMenu.source.web",
        message: "Web app",
      });
    case "outlook":
      return t({
        id: "chat.history.filterMenu.source.outlook",
        message: "Outlook",
      });
    case "word":
      return t({ id: "chat.history.filterMenu.source.word", message: "Word" });
    case "officeAddin":
      return t({
        id: "chat.history.filterMenu.source.officeAddin",
        message: "Office add-in",
      });
    case "teams":
      return t({
        id: "chat.history.filterMenu.source.teams",
        message: "Teams",
      });
    case "legacy":
      return t({
        id: "chat.history.filterMenu.source.legacy",
        message: "Older chats",
      });
  }
};

/** One choice among values: picking one closes the menu. */
function choiceRow<V extends string>(
  key: Exclude<FilterMenuRowKey, "source">,
  label: string,
  options: readonly { value: V; label: string }[],
  current: V,
): MenuEntry {
  return {
    id: key,
    label,
    subtitle: options.find((option) => option.value === current)?.label,
    selection: "single",
    children: options.map((option) => ({
      id: choiceId(key, option.value),
      label: option.label,
      state: option.value === current ? "on" : "off",
    })),
  };
}

/**
 * The sidebar's filter and sort menu. Each row's current value is data
 * (its subtitle), not text beside its label, so a system menu shows it too.
 */
export function describeFilterMenu(
  values: ChatHistoryFilterValues,
  capabilities: ChatHistoryFilterCapabilities,
): MenuEntry[] {
  const { assistantsEnabled, delegationEnabled, availableSources } =
    capabilities;
  const filters = sanitizeChatHistoryFilters(values, capabilities);

  const rows: MenuEntry[] = [];
  if (assistantsEnabled) {
    rows.push(
      choiceRow(
        "type",
        t({ id: "chat.history.filterMenu.type", message: "Type" }),
        [
          {
            value: "all",
            label: t({
              id: "chat.history.filterMenu.type.all",
              message: "All",
            }),
          },
          {
            value: "chat",
            label: t({
              id: "chat.history.filterMenu.type.chat",
              message: "Chat",
            }),
          },
          {
            value: "assistant",
            label: t({
              id: "chat.history.filterMenu.type.assistant",
              message: "Assistant",
            }),
          },
        ],
        filters.typeFilter,
      ),
    );
  }
  rows.push(
    choiceRow(
      "status",
      t({ id: "chat.history.filterMenu.status", message: "Status" }),
      [
        {
          value: "active",
          label: t({
            id: "chat.history.filterMenu.status.active",
            message: "Active",
          }),
        },
        {
          value: "all",
          label: t({
            id: "chat.history.filterMenu.status.all",
            message: "All",
          }),
        },
      ],
      filters.statusFilter,
    ),
  );
  if (assistantsEnabled && delegationEnabled) {
    rows.push(
      choiceRow(
        "delegated",
        t({
          id: "chat.history.filterMenu.delegated",
          message: "Delegated runs",
        }),
        [
          {
            value: "hidden",
            label: t({
              id: "chat.history.filterMenu.delegated.hidden",
              message: "Hidden",
            }),
          },
          {
            value: "shown",
            label: t({
              id: "chat.history.filterMenu.delegated.shown",
              message: "Shown",
            }),
          },
        ],
        filters.delegatedFilter,
      ),
    );
  }
  if (isSourceFilterAvailable(availableSources)) {
    rows.push(describeSourceRow(filters.sourceFilter, availableSources));
  }

  const groupBy = choiceRow(
    // eslint-disable-next-line lingui/no-unlocalized-strings -- entry id
    "groupBy",
    t({ id: "chat.history.filterMenu.groupBy", message: "Group by" }),
    [
      {
        value: "date",
        label: t({
          id: "chat.history.filterMenu.groupBy.date",
          message: "Date",
        }),
      },
      ...(assistantsEnabled
        ? [
            {
              value: "type" as const,
              label: t({
                id: "chat.history.filterMenu.groupBy.type",
                message: "Type",
              }),
            },
          ]
        : []),
      {
        value: "unread",
        label: t({
          id: "chat.history.filterMenu.groupBy.unread",
          message: "Unread",
        }),
      },
      {
        value: "none",
        label: t({
          id: "chat.history.filterMenu.groupBy.none",
          message: "None",
        }),
      },
    ],
    filters.groupBy,
  );

  return [
    { id: "filters", inline: true, children: rows },
    { id: "grouping", inline: true, children: [groupBy] },
    {
      id: "actions",
      inline: true,
      children: [
        {
          id: FILTER_MENU_RESET_ID,
          label: t({
            id: "chat.history.filterMenu.reset",
            message: "Reset to defaults",
          }),
        },
      ],
    },
  ];
}

/**
 * Source: a mode, then the sources it applies to. Both stay open on a pick,
 * since a mode is chosen to tick sources next.
 */
function describeSourceRow(
  sourceFilter: ChatHistoryFilterValues["sourceFilter"],
  availableSources: readonly ChatHistorySource[],
): MenuEntry {
  const { mode, sources } = sourceFilter;
  const modeLabels: Record<ChatHistorySourceMode, string> = {
    all: t({ id: "chat.history.filterMenu.source.mode.all", message: "All" }),
    only: t({
      id: "chat.history.filterMenu.source.mode.only",
      message: "Only selected",
    }),
    hide: t({
      id: "chat.history.filterMenu.source.mode.hide",
      message: "Hide selected",
    }),
  };
  const selectedLabels = sources.map(sourceLabel).join(", ");
  const subtitle = !isSourceFilterActive(sourceFilter)
    ? modeLabels.all
    : mode === "only"
      ? t({
          id: "chat.history.filterMenu.source.onlyValue",
          message: `Only: ${selectedLabels}`,
        })
      : t({
          id: "chat.history.filterMenu.source.hideValue",
          message: `Hiding: ${selectedLabels}`,
        });

  return {
    id: "source",
    label: t({ id: "chat.history.filterMenu.source", message: "Source" }),
    subtitle,
    children: [
      {
        id: SOURCE_MODE_SECTION_ID,
        inline: true,
        selection: "single",
        children: SOURCE_MODE_VALUES.map((value) => ({
          // eslint-disable-next-line lingui/no-unlocalized-strings -- entry id
          id: choiceId("sourceMode", value),
          label: modeLabels[value],
          state: value === mode ? "on" : "off",
          keepOpen: true,
        })),
      },
      {
        id: SOURCES_SECTION_ID,
        inline: true,
        label: t({
          id: "chat.history.filterMenu.source.sources",
          message: "Sources",
        }),
        selection: "multiple",
        children: CHAT_HISTORY_SOURCE_VALUES.filter((source) =>
          availableSources.includes(source),
        ).map((source) => ({
          id: choiceId("source", source),
          label: sourceLabel(source),
          state: sources.includes(source) ? "on" : "off",
          keepOpen: true,
          ...(mode === "all" ? { disabled: true } : {}),
        })),
      },
    ],
  };
}
