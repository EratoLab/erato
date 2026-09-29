import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

export type ChatHistoryTypeFilter = "all" | "chat" | "assistant";
export type ChatHistoryStatusFilter = "active" | "all";
export type ChatHistoryDelegatedFilter = "hidden" | "shown";
export type ChatHistoryGroupBy = "date" | "type" | "unread" | "none";

/**
 * Where a chat was started, as the list filter offers it. Coarser than the
 * backend's `created_via`: the Teams tab and the Teams bot share "teams".
 */
export type ChatHistorySource =
  | "web"
  | "outlook"
  | "word"
  | "officeAddin"
  | "teams"
  | "legacy";
export type ChatHistorySourceMode = "all" | "only" | "hide";

export interface ChatHistorySourceFilter {
  mode: ChatHistorySourceMode;
  /**
   * Kept while the mode is "all", so switching back to "only"/"hide" restores
   * the previous pick. Always in `CHAT_HISTORY_SOURCE_VALUES` order, so equal
   * selections produce equal query keys.
   */
  sources: readonly ChatHistorySource[];
}

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
  /** Which surfaces' chats the list keeps or leaves out. */
  sourceFilter: ChatHistorySourceFilter;
}

interface ChatHistoryFilterStore extends ChatHistoryFilterValues {
  setTypeFilter: (typeFilter: ChatHistoryTypeFilter) => void;
  setStatusFilter: (statusFilter: ChatHistoryStatusFilter) => void;
  setDelegatedFilter: (delegatedFilter: ChatHistoryDelegatedFilter) => void;
  setGroupBy: (groupBy: ChatHistoryGroupBy) => void;
  setSourceFilter: (sourceFilter: ChatHistorySourceFilter) => void;
  setSourceMode: (mode: ChatHistorySourceMode) => void;
  toggleSource: (source: ChatHistorySource) => void;
  resetToDefaults: () => void;
}

export const CHAT_HISTORY_SOURCE_FILTER_DEFAULT: ChatHistorySourceFilter = {
  mode: "all",
  sources: [],
};

export const CHAT_HISTORY_FILTER_DEFAULTS: ChatHistoryFilterValues = {
  typeFilter: "all",
  statusFilter: "active",
  delegatedFilter: "hidden",
  groupBy: "date",
  sourceFilter: CHAT_HISTORY_SOURCE_FILTER_DEFAULT,
};

/** Every source, in the order the menu lists them. */
export const CHAT_HISTORY_SOURCE_VALUES: readonly ChatHistorySource[] = [
  "web",
  "outlook",
  "word",
  "officeAddin",
  "teams",
  "legacy",
];
const SOURCE_MODE_VALUES: readonly ChatHistorySourceMode[] = [
  "all",
  "only",
  "hide",
];

/** The backend `created_via` values each source stands for. */
export const CHAT_HISTORY_SOURCE_CREATED_VIA: Record<
  ChatHistorySource,
  readonly string[]
> = {
  web: ["web"],
  outlook: ["outlook"],
  word: ["word"],
  officeAddin: ["office_addin"],
  teams: ["ms_teams_tab", "ms_teams_bot"],
  legacy: ["legacy"],
};

/**
 * The sources a deployment's `created_via` values map to, in menu order.
 * Unknown values are ignored.
 */
export function chatHistorySourcesFromCreatedVia(
  createdVia: readonly string[],
): ChatHistorySource[] {
  return CHAT_HISTORY_SOURCE_VALUES.filter((source) =>
    CHAT_HISTORY_SOURCE_CREATED_VIA[source].some((value) =>
      createdVia.includes(value),
    ),
  );
}

/**
 * Whether a source filter is worth offering: with no integration enabled,
 * every chat is either a web chat or an older one.
 */
export function isSourceFilterAvailable(
  availableSources: readonly ChatHistorySource[],
): boolean {
  return availableSources.some(
    (source) => source !== "web" && source !== "legacy",
  );
}

/** Whether the source filter changes which chats the list contains. */
export function isSourceFilterActive(filter: ChatHistorySourceFilter): boolean {
  return filter.mode !== "all" && filter.sources.length > 0;
}

/** Whether the list keeps a chat from `source` under this filter. */
export function sourceFilterKeeps(
  filter: ChatHistorySourceFilter,
  source: ChatHistorySource,
): boolean {
  if (!isSourceFilterActive(filter)) return true;
  const selected = filter.sources.includes(source);
  return filter.mode === "only" ? selected : !selected;
}

function sameSourceFilter(
  a: ChatHistorySourceFilter,
  b: ChatHistorySourceFilter,
): boolean {
  return (
    a.mode === b.mode &&
    a.sources.length === b.sources.length &&
    a.sources.every((source, index) => source === b.sources[index])
  );
}

/** Known sources only, deduplicated, in menu order. */
function canonicalSources(sources: readonly unknown[]): ChatHistorySource[] {
  return CHAT_HISTORY_SOURCE_VALUES.filter((source) =>
    sources.includes(source),
  );
}

/** Coerces a persisted (user-editable) value into a source filter. */
function coerceSourceFilter(value: unknown): ChatHistorySourceFilter {
  if (typeof value !== "object" || value === null) {
    return CHAT_HISTORY_SOURCE_FILTER_DEFAULT;
  }
  const { mode, sources } = value as Record<string, unknown>;
  return {
    mode: coerceToUnion(
      mode,
      SOURCE_MODE_VALUES,
      CHAT_HISTORY_SOURCE_FILTER_DEFAULT.mode,
    ),
    sources: Array.isArray(sources) ? canonicalSources(sources) : [],
  };
}

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
    values.groupBy === CHAT_HISTORY_FILTER_DEFAULTS.groupBy &&
    sameSourceFilter(
      values.sourceFilter,
      CHAT_HISTORY_FILTER_DEFAULTS.sourceFilter,
    )
  );
}

/**
 * Whether a filter that changes which chats the list contains is active —
 * whether it drops rows (type, status, source) or adds them (delegated runs).
 * Grouping only rearranges the same rows, so it deliberately does not count.
 */
export function hasActiveFilters(values: ChatHistoryFilterValues): boolean {
  return (
    values.typeFilter !== CHAT_HISTORY_FILTER_DEFAULTS.typeFilter ||
    values.statusFilter !== CHAT_HISTORY_FILTER_DEFAULTS.statusFilter ||
    values.delegatedFilter !== CHAT_HISTORY_FILTER_DEFAULTS.delegatedFilter ||
    isSourceFilterActive(values.sourceFilter)
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

          setSourceFilter: (sourceFilter) =>
            set(
              {
                sourceFilter: {
                  mode: sourceFilter.mode,
                  sources: canonicalSources(sourceFilter.sources),
                },
              },
              false,
              "chatHistoryFilter/setSourceFilter",
            ),

          setSourceMode: (mode) =>
            set(
              (state) => ({ sourceFilter: { ...state.sourceFilter, mode } }),
              false,
              "chatHistoryFilter/setSourceMode",
            ),

          toggleSource: (source) =>
            set(
              (state) => {
                const { sources } = state.sourceFilter;
                return {
                  sourceFilter: {
                    ...state.sourceFilter,
                    sources: sources.includes(source)
                      ? sources.filter((selected) => selected !== source)
                      : canonicalSources([...sources, source]),
                  },
                };
              },
              false,
              "chatHistoryFilter/toggleSource",
            ),

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
            sourceFilter: state.sourceFilter,
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
              // Absent from blobs persisted before this facet existed, which
              // coerces to "all".
              sourceFilter: coerceSourceFilter(stored.sourceFilter),
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
  /** Sources chats can come from in this deployment. */
  availableSources: readonly ChatHistorySource[];
}

/**
 * Feature-scoped values fall back to their defaults while the feature that
 * offers them is off, instead of invisibly filtering, grouping or widening
 * the list by a criterion the menu no longer shows:
 * - assistants: a type filter other than "all", grouping by type;
 * - delegation: showing delegated runs;
 * - sources: sources this deployment no longer offers, and the whole source
 *   filter when no integration is enabled.
 */
export function sanitizeChatHistoryFilters(
  values: ChatHistoryFilterValues,
  {
    assistantsEnabled,
    delegationEnabled,
    availableSources,
  }: ChatHistoryFilterCapabilities,
): ChatHistoryFilterValues {
  const delegatedFilter =
    assistantsEnabled && delegationEnabled
      ? values.delegatedFilter
      : CHAT_HISTORY_FILTER_DEFAULTS.delegatedFilter;
  const sourceFilter = sanitizeSourceFilter(
    values.sourceFilter,
    availableSources,
  );
  if (assistantsEnabled) {
    return delegatedFilter === values.delegatedFilter &&
      sourceFilter === values.sourceFilter
      ? values
      : { ...values, delegatedFilter, sourceFilter };
  }
  return {
    ...values,
    typeFilter: CHAT_HISTORY_FILTER_DEFAULTS.typeFilter,
    delegatedFilter,
    sourceFilter,
    groupBy:
      values.groupBy === "type"
        ? CHAT_HISTORY_FILTER_DEFAULTS.groupBy
        : values.groupBy,
  };
}

/** Returns `filter` itself when nothing had to change. */
function sanitizeSourceFilter(
  filter: ChatHistorySourceFilter,
  availableSources: readonly ChatHistorySource[],
): ChatHistorySourceFilter {
  if (!isSourceFilterAvailable(availableSources)) {
    return sameSourceFilter(filter, CHAT_HISTORY_SOURCE_FILTER_DEFAULT)
      ? filter
      : CHAT_HISTORY_SOURCE_FILTER_DEFAULT;
  }
  const sources = filter.sources.filter((source) =>
    availableSources.includes(source),
  );
  return sources.length === filter.sources.length
    ? filter
    : { ...filter, sources };
}

/**
 * Store values with assistant-scoped ones sanitized for the current config.
 * The store must be the same instance for a component's whole lifetime — it
 * is read through hooks.
 */
export const useSanitizedChatHistoryFilters = (
  {
    assistantsEnabled,
    delegationEnabled,
    availableSources,
  }: ChatHistoryFilterCapabilities,
  store: ChatHistoryFilterStoreHook = useChatHistoryFilterStore,
): ChatHistoryFilterValues => {
  const typeFilter = store((state) => state.typeFilter);
  const statusFilter = store((state) => state.statusFilter);
  const delegatedFilter = store((state) => state.delegatedFilter);
  const groupBy = store((state) => state.groupBy);
  const sourceFilter = store((state) => state.sourceFilter);

  // Capabilities are destructured into primitives on purpose: callers build
  // the object inline, so depending on its identity would rerun this on every
  // render. The source list is keyed by its contents for the same reason.
  const availableSourcesKey = availableSources.join(",");
  return useMemo(
    () =>
      sanitizeChatHistoryFilters(
        { typeFilter, statusFilter, delegatedFilter, groupBy, sourceFilter },
        {
          assistantsEnabled,
          delegationEnabled,
          availableSources: availableSourcesKey
            ? (availableSourcesKey.split(",") as ChatHistorySource[])
            : [],
        },
      ),
    [
      typeFilter,
      statusFilter,
      delegatedFilter,
      groupBy,
      sourceFilter,
      assistantsEnabled,
      delegationEnabled,
      availableSourcesKey,
    ],
  );
};

/**
 * Folds feature-scoped filter values back to their defaults in the store
 * itself while their feature is off: the recent-chats query (and any other
 * reader) consumes the raw persisted values, so sanitizing only at render
 * would let a stale persisted value keep filtering the request invisibly.
 */
export const useChatHistoryFilterFoldback = (
  {
    assistantsEnabled,
    delegationEnabled,
    availableSources,
  }: ChatHistoryFilterCapabilities,
  store: ChatHistoryFilterStoreHook = useChatHistoryFilterStore,
): void => {
  const availableSourcesKey = availableSources.join(",");
  useEffect(() => {
    const state = store.getState();
    const sanitized = sanitizeChatHistoryFilters(state, {
      assistantsEnabled,
      delegationEnabled,
      availableSources: availableSourcesKey
        ? (availableSourcesKey.split(",") as ChatHistorySource[])
        : [],
    });
    if (sanitized.sourceFilter !== state.sourceFilter) {
      state.setSourceFilter(sanitized.sourceFilter);
    }
    if (assistantsEnabled && delegationEnabled) return;
    if (sanitized.typeFilter !== state.typeFilter) {
      state.setTypeFilter(sanitized.typeFilter);
    }
    if (sanitized.delegatedFilter !== state.delegatedFilter) {
      state.setDelegatedFilter(sanitized.delegatedFilter);
    }
    if (sanitized.groupBy !== state.groupBy) {
      state.setGroupBy(sanitized.groupBy);
    }
  }, [assistantsEnabled, delegationEnabled, availableSourcesKey, store]);
};
