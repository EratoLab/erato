import { isImplementedClientAction } from "./wordClientActions";
import { createClientActionDecisionStore } from "../../core/clientActions/clientActionPolicy";

export {
  clientActionSessionGrantVersion,
  decisionKey,
  effectiveDecision,
  grantClientActionForSession,
  isActionDenied,
  resolveAutoPromptBehavior,
  scopedDecisions,
  type ClientActionDecision,
  type ClientActionDecisionMap,
  type ClientActionGrantScope,
} from "../../core/clientActions/clientActionPolicy";

/** Keep decisions per host: each registry discards unknown actions when reading its store. */
export const WORD_CLIENT_ACTION_DECISIONS_KEY =
  "erato.addin.word.clientActionDecisions";

export const wordClientActionDecisionStore = createClientActionDecisionStore({
  storageKey: WORD_CLIENT_ACTION_DECISIONS_KEY,
  isImplementedAction: isImplementedClientAction,
});
