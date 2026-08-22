import { useEffect, useMemo } from "react";
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
 * Whether a filter that can exclude chats from the list is active. Grouping
 * only rearranges the same rows, so it deliberately does not count.
 */
export function hasActiveFilters(values: ChatHistoryFilterValues): boolean {
  return (
    values.typeFilter !== CHAT_HISTORY_FILTER_DEFAULTS.typeFilter ||
    values.statusFilter !== CHAT_HISTORY_FILTER_DEFAULTS.statusFilter
  );
}

/**
 * Chat-list filter/sort preference store, persisted per browser under the
 * given key so the list comes back the way the user left it. A factory
 * because every surface family needs its own persistence: sharing one key
 * would let a web sidebar filter silently shrink an add-in host's list.
 */
export function createChatHistoryFilterStore(persistName: string) {
  return create<ChatHistoryFilterStore>()(
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
          name: persistName,
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
        store: persistName,
        enabled: process.env.NODE_ENV === "development",
      },
    ),
  );
}

export type ChatHistoryFilterStoreHook = ReturnType<
  typeof createChatHistoryFilterStore
>;

/** The web sidebar's singleton instance. */
export const useChatHistoryFilterStore = createChatHistoryFilterStore(
  "erato.sidebar.chatHistoryFilters",
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

/**
 * Store values with assistant-scoped ones sanitized for the current config.
 * The store must be the same instance for a component's whole lifetime — it
 * is read through hooks.
 */
export const useSanitizedChatHistoryFilters = (
  assistantsEnabled: boolean,
  store: ChatHistoryFilterStoreHook = useChatHistoryFilterStore,
): ChatHistoryFilterValues => {
  const typeFilter = store((state) => state.typeFilter);
  const statusFilter = store((state) => state.statusFilter);
  const groupBy = store((state) => state.groupBy);

  return useMemo(
    () =>
      sanitizeChatHistoryFilters(
        { typeFilter, statusFilter, groupBy },
        assistantsEnabled,
      ),
    [typeFilter, statusFilter, groupBy, assistantsEnabled],
  );
};

/**
 * Folds assistant-scoped filter values back to their defaults in the store
 * itself while assistants are disabled: the recent-chats query (and any other
 * reader) consumes the raw persisted values, so sanitizing only at render
 * would let a stale persisted value keep filtering the request invisibly.
 */
export const useChatHistoryFilterFoldback = (
  assistantsEnabled: boolean,
  store: ChatHistoryFilterStoreHook = useChatHistoryFilterStore,
): void => {
  useEffect(() => {
    if (assistantsEnabled) return;
    const state = store.getState();
    const sanitized = sanitizeChatHistoryFilters(state, false);
    if (sanitized.typeFilter !== state.typeFilter) {
      state.setTypeFilter(sanitized.typeFilter);
    }
    if (sanitized.groupBy !== state.groupBy) {
      state.setGroupBy(sanitized.groupBy);
    }
  }, [assistantsEnabled, store]);
};
