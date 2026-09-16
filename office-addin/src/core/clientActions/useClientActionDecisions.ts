import { usePersistedState } from "@erato/frontend/library";

import type {
  ClientActionDecisionMap,
  ClientActionDecisionStore,
} from "./clientActionPolicy";

/**
 * The host's stored ask/always/never decisions as persisted state. One call
 * per renderer or settings surface; all of them share the store's key, so a
 * card writing "always allow" is visible to the settings rows immediately.
 */
export function useClientActionDecisions(
  store: ClientActionDecisionStore,
): [ClientActionDecisionMap, (value: ClientActionDecisionMap | null) => void] {
  return usePersistedState(
    store.storageKey,
    store.defaultDecisions,
    store.persistedOptions,
  );
}
