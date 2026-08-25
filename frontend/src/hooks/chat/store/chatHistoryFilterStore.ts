import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

export type ChatHistoryTypeFilter = "all" | "chat" | "assistant";
export type ChatHistoryStatusFilter = "active" | "all";
export type ChatHistoryDelegatedFilter = "hidden" | "shown";
export type ChatHistoryGroupBy = "date" | "type" | "unread" | "none";

export interface ChatHistoryFilterValues {
  typeFilter: ChatHistoryTypeFilter;
  statusFilter: ChatHistoryStatusFilter;
  /**
   * Whether chats spawned as delegated runs join the list. Orthogonal to
   * `typeFilter` rather than a value of it: a delegated run is usually an
   * assistant chat, so the two dimensions have to compose.
   */
  delegatedFilter: ChatHistoryDelegatedFilter;
  groupBy: ChatHistoryGroupBy;
}

interface ChatHistoryFilterStore extends ChatHistoryFilterValues {
  setTypeFilter: (typeFilter: ChatHistoryTypeFilter) => void;
  setStatusFilter: (statusFilter: ChatHistoryStatusFilter) => void;
  setDelegatedFilter: (delegatedFilter: ChatHistoryDelegatedFilter) => void;
  setGroupBy: (groupBy: ChatHistoryGroupBy) => void;
  resetToDefaults: () => void;
}

export const CHAT_HISTORY_FILTER_DEFAULTS: ChatHistoryFilterValues = {
  typeFilter: "all",
  statusFilter: "active",
  delegatedFilter: "hidden",
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
const DELEGATED_FILTER_VALUES: readonly ChatHistoryDelegatedFilter[] = [
  "hidden",
  "shown",
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
    values.delegatedFilter === CHAT_HISTORY_FILTER_DEFAULTS.delegatedFilter &&
    values.groupBy === CHAT_HISTORY_FILTER_DEFAULTS.groupBy
  );
}

/**
 * Whether a filter that changes which chats the list contains is active —
 * whether it drops rows (type, status) or adds them (delegated runs).
 * Grouping only rearranges the same rows, so it deliberately does not count.
 */
export function hasActiveFilters(values: ChatHistoryFilterValues): boolean {
  return (
    values.typeFilter !== CHAT_HISTORY_FILTER_DEFAULTS.typeFilter ||
    values.statusFilter !== CHAT_HISTORY_FILTER_DEFAULTS.statusFilter ||
    values.delegatedFilter !== CHAT_HISTORY_FILTER_DEFAULTS.delegatedFilter
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

          setDelegatedFilter: (delegatedFilter) =>
            set(
              { delegatedFilter },
              false,
              "chatHistoryFilter/setDelegatedFilter",
            ),

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
            delegatedFilter: state.delegatedFilter,
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
              // Absent from every blob persisted before this facet existed,
              // which coerces to the default — the same "hidden" the list has
              // always had.
              delegatedFilter: coerceToUnion(
                stored.delegatedFilter,
                DELEGATED_FILTER_VALUES,
                CHAT_HISTORY_FILTER_DEFAULTS.delegatedFilter,
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

/** The feature gates that decide which filter values the menu offers. */
export interface ChatHistoryFilterCapabilities {
  assistantsEnabled: boolean;
  /**
   * Delegation implies assistants, so the delegated facet needs both gates —
   * same pairing `DelegatedRunsSection` uses to decide a chat can have runs.
   */
  delegationEnabled: boolean;
}

/**
 * Feature-scoped values fall back to their defaults while the feature that
 * offers them is off, instead of invisibly filtering, grouping or widening
 * the list by a criterion the menu no longer shows:
 * - assistants: a type filter other than "all", grouping by type;
 * - delegation: showing delegated runs.
 */
export function sanitizeChatHistoryFilters(
  values: ChatHistoryFilterValues,
  { assistantsEnabled, delegationEnabled }: ChatHistoryFilterCapabilities,
): ChatHistoryFilterValues {
  const delegatedFilter =
    assistantsEnabled && delegationEnabled
      ? values.delegatedFilter
      : CHAT_HISTORY_FILTER_DEFAULTS.delegatedFilter;
  if (assistantsEnabled) {
    return delegatedFilter === values.delegatedFilter
      ? values
      : { ...values, delegatedFilter };
  }
  return {
    ...values,
    typeFilter: CHAT_HISTORY_FILTER_DEFAULTS.typeFilter,
    delegatedFilter,
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
  { assistantsEnabled, delegationEnabled }: ChatHistoryFilterCapabilities,
  store: ChatHistoryFilterStoreHook = useChatHistoryFilterStore,
): ChatHistoryFilterValues => {
  const typeFilter = store((state) => state.typeFilter);
  const statusFilter = store((state) => state.statusFilter);
  const delegatedFilter = store((state) => state.delegatedFilter);
  const groupBy = store((state) => state.groupBy);

  // Capabilities are destructured into primitives on purpose: callers build
  // the object inline, so depending on its identity would rerun this on every
  // render.
  return useMemo(
    () =>
      sanitizeChatHistoryFilters(
        { typeFilter, statusFilter, delegatedFilter, groupBy },
        { assistantsEnabled, delegationEnabled },
      ),
    [
      typeFilter,
      statusFilter,
      delegatedFilter,
      groupBy,
      assistantsEnabled,
      delegationEnabled,
    ],
  );
};

/**
 * Folds assistant-scoped filter values back to their defaults in the store
 * itself while assistants are disabled: the recent-chats query (and any other
 * reader) consumes the raw persisted values, so sanitizing only at render
 * would let a stale persisted value keep filtering the request invisibly.
 */
export const useChatHistoryFilterFoldback = (
  { assistantsEnabled, delegationEnabled }: ChatHistoryFilterCapabilities,
  store: ChatHistoryFilterStoreHook = useChatHistoryFilterStore,
): void => {
  useEffect(() => {
    if (assistantsEnabled && delegationEnabled) return;
    const state = store.getState();
    const sanitized = sanitizeChatHistoryFilters(state, {
      assistantsEnabled,
      delegationEnabled,
    });
    if (sanitized.typeFilter !== state.typeFilter) {
      state.setTypeFilter(sanitized.typeFilter);
    }
    if (sanitized.delegatedFilter !== state.delegatedFilter) {
      state.setDelegatedFilter(sanitized.delegatedFilter);
    }
    if (sanitized.groupBy !== state.groupBy) {
      state.setGroupBy(sanitized.groupBy);
    }
  }, [assistantsEnabled, delegationEnabled, store]);
};
