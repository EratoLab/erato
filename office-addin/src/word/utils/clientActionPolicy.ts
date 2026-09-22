import { isImplementedClientAction } from "./wordClientActions";
import { createClientActionDecisionStore } from "../../core/clientActions/clientActionPolicy";

export {
  decisionKey,
  effectiveDecision,
  isActionDenied,
  resolveAutoPromptBehavior,
  type ClientActionDecision,
  type ClientActionDecisionMap,
} from "../../core/clientActions/clientActionPolicy";

/**
 * Keep a host-specific storage key: parsing discards unsupported actions, so
 * sharing a key would let one host erase the other's decisions. Create the
 * store once at module scope because usePersistedState needs stable options.
 */
export const wordClientActionDecisionStore = createClientActionDecisionStore({
  storageKey: "erato.addin.word.clientActionDecisions",
  isImplementedAction: isImplementedClientAction,
});
