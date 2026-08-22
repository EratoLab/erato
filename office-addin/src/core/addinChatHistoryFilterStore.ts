import {
  createChatHistoryFilterStore,
  type ChatHistoryFilterStoreHook,
} from "@erato/frontend/library";
import { createContext, useContext } from "react";

const storesByPlatform = new Map<string, ChatHistoryFilterStoreHook>();

/**
 * Per-platform filter store: each host keeps its own persisted filters, so a
 * filter set in one surface (or the web sidebar, which owns the un-prefixed
 * key) can never silently shrink another host's list. Cached per platform so
 * every resolver gets the same instance.
 */
export function getAddinChatHistoryFilterStore(
  platform: string,
): ChatHistoryFilterStoreHook {
  let store = storesByPlatform.get(platform);
  if (!store) {
    store = createChatHistoryFilterStore(
      `erato.addin.${platform}.chatHistoryFilters.v1`,
    );
    storesByPlatform.set(platform, store);
  }
  return store;
}

/**
 * The mounted provider's filter store, carried by context so consumers (the
 * history drawer's filter menu) never have to agree with the provider on a
 * platform string.
 */
export const AddinHistoryFilterStoreContext =
  createContext<ChatHistoryFilterStoreHook | null>(null);

export function useAddinHistoryFilterStore(): ChatHistoryFilterStoreHook {
  const store = useContext(AddinHistoryFilterStoreContext);
  if (!store) {
    throw new Error(
      "useAddinHistoryFilterStore must be used within AddinChatProviderCore",
    );
  }
  return store;
}
