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
export const wordClientActionDecisionStore = createClientActionDecisionStore({
  storageKey: "erato.addin.word.clientActionDecisions",
  isImplementedAction: isImplementedClientAction,
});
