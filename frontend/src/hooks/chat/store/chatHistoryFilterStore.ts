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
