import { useMemo } from "react";
import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

export type ChatHistoryTypeFilter = "all" | "chat" | "assistant";
export type ChatHistoryStatusFilter = "active" | "all";
export type ChatHistoryGroupBy = "date" | "type" | "unread" | "none";

export interface ChatHistoryFilterValues {
  typeFilter: ChatHistoryTypeFilter;
  statusFilter: ChatHistoryStatusFilter;
  groupBy: ChatHistoryGroupBy;
}

interface ChatHistoryFilterStore extends ChatHistoryFilterValues {
  setTypeFilter: (typeFilter: ChatHistoryTypeFilter) => void;
  setStatusFilter: (statusFilter: ChatHistoryStatusFilter) => void;
  setGroupBy: (groupBy: ChatHistoryGroupBy) => void;
  resetToDefaults: () => void;
}

export const CHAT_HISTORY_FILTER_DEFAULTS: ChatHistoryFilterValues = {
  typeFilter: "all",
  statusFilter: "active",
  groupBy: "date",
};

const TYPE_FILTER_VALUES: readonly ChatHistoryTypeFilter[] = [
  "all",
  "chat",
  "assistant",
];
const STATUS_FILTER_VALUES: readonly ChatHistoryStatusFilter[] = [
  "active",
  "all",
];
const GROUP_BY_VALUES: readonly ChatHistoryGroupBy[] = [
  "date",
  "type",
  "unread",
  "none",
];

const coerceToUnion = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T => (allowed.includes(value as T) ? (value as T) : fallback);

/** Whether `values` are exactly the out-of-the-box filter configuration. */
export function isDefaultFilters(values: ChatHistoryFilterValues): boolean {
  return (
    values.typeFilter === CHAT_HISTORY_FILTER_DEFAULTS.typeFilter &&
    values.statusFilter === CHAT_HISTORY_FILTER_DEFAULTS.statusFilter &&
    values.groupBy === CHAT_HISTORY_FILTER_DEFAULTS.groupBy
  );
}

/**
 * Sidebar chat-list filter/sort preferences, persisted per browser so the
 * list comes back the way the user left it.
 */
export const useChatHistoryFilterStore = create<ChatHistoryFilterStore>()(
  devtools(
    persist(
      (set) => ({
        ...CHAT_HISTORY_FILTER_DEFAULTS,

        setTypeFilter: (typeFilter) =>
          set({ typeFilter }, false, "chatHistoryFilter/setTypeFilter"),

        setStatusFilter: (statusFilter) =>
          set({ statusFilter }, false, "chatHistoryFilter/setStatusFilter"),

        setGroupBy: (groupBy) =>
          set({ groupBy }, false, "chatHistoryFilter/setGroupBy"),

        resetToDefaults: () =>
          set(
            { ...CHAT_HISTORY_FILTER_DEFAULTS },
            false,
            "chatHistoryFilter/resetToDefaults",
          ),
      }),
      {
        name: "erato.sidebar.chatHistoryFilters",
        partialize: (state) => ({
          typeFilter: state.typeFilter,
          statusFilter: state.statusFilter,
          groupBy: state.groupBy,
        }),
        // localStorage is user-editable, so each rehydrated field must be
        // coerced back into its union; an out-of-union value would otherwise
        // flow unchecked into query params and the grouping switch.
        merge: (persisted, current) => {
          const stored = (persisted ?? {}) as Partial<
            Record<keyof ChatHistoryFilterValues, unknown>
          >;
          return {
            ...current,
            typeFilter: coerceToUnion(
              stored.typeFilter,
              TYPE_FILTER_VALUES,
              CHAT_HISTORY_FILTER_DEFAULTS.typeFilter,
            ),
            statusFilter: coerceToUnion(
              stored.statusFilter,
              STATUS_FILTER_VALUES,
              CHAT_HISTORY_FILTER_DEFAULTS.statusFilter,
            ),
            groupBy: coerceToUnion(
              stored.groupBy,
              GROUP_BY_VALUES,
              CHAT_HISTORY_FILTER_DEFAULTS.groupBy,
            ),
          };
        },
      },
    ),
    {
      name: "Chat History Filter Store",
      store: "chat-history-filter-store",
      enabled: process.env.NODE_ENV === "development",
    },
  ),
);

/**
 * Assistant-scoped values (a type filter other than "all", grouping by type)
 * only make sense while assistants are available. A value persisted when they
 * were enabled falls back to its default instead of invisibly filtering or
 * grouping the list by a criterion the menu no longer offers.
 */
export function sanitizeChatHistoryFilters(
  values: ChatHistoryFilterValues,
  assistantsEnabled: boolean,
): ChatHistoryFilterValues {
  if (assistantsEnabled) {
    return values;
  }
  return {
    ...values,
    typeFilter: CHAT_HISTORY_FILTER_DEFAULTS.typeFilter,
    groupBy:
      values.groupBy === "type"
        ? CHAT_HISTORY_FILTER_DEFAULTS.groupBy
        : values.groupBy,
  };
}

/** Store values with assistant-scoped ones sanitized for the current config. */
export const useSanitizedChatHistoryFilters = (
  assistantsEnabled: boolean,
): ChatHistoryFilterValues => {
  const typeFilter = useChatHistoryFilterStore((state) => state.typeFilter);
  const statusFilter = useChatHistoryFilterStore((state) => state.statusFilter);
  const groupBy = useChatHistoryFilterStore((state) => state.groupBy);

  return useMemo(
    () =>
      sanitizeChatHistoryFilters(
        { typeFilter, statusFilter, groupBy },
        assistantsEnabled,
      ),
    [typeFilter, statusFilter, groupBy, assistantsEnabled],
  );
};
