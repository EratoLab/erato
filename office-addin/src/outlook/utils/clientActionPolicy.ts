import { isImplementedClientAction } from "./outlookClientActions";
import {
  createClientActionDecisionStore,
  mergeIntoStoredDecisions as mergeIntoStoredDecisionsFor,
} from "../../core/clientActions/clientActionPolicy";

import type { ClientActionDecisionMap } from "../../core/clientActions/clientActionPolicy";

export {
  decisionKey,
  effectiveDecision,
  isActionDenied,
  isClientActionDecision,
  parseDecisionKey,
  resolveAutoPromptBehavior,
  type AutoPromptBehavior,
  type ClientActionDecision,
  type ClientActionDecisionMap,
} from "../../core/clientActions/clientActionPolicy";

/**
 * The Outlook binding of the host-neutral decision engine: Outlook's action
 * registry decides which stored entries this build owns, under the key the
 * add-in has always used. The key predates the `erato.addin.<host>.*`
 * convention and deliberately stays — renaming it would silently reset every
 * user's ask/always/never decisions (see ARCHITECTURE.md, Conventions).
 */
export const outlookClientActionDecisionStore = createClientActionDecisionStore(
  {
    storageKey: "erato.outlookAddin.clientActionDecisions",
    isImplementedAction: isImplementedClientAction,
  },
);

/** @deprecated Use {@link outlookClientActionDecisionStore}`.storageKey`. */
export const CLIENT_ACTION_DECISIONS_KEY =
  outlookClientActionDecisionStore.storageKey;

/** @deprecated Use {@link outlookClientActionDecisionStore}`.defaultDecisions`. */
export const DEFAULT_CLIENT_ACTION_DECISIONS =
  outlookClientActionDecisionStore.defaultDecisions;

/** @deprecated Use {@link outlookClientActionDecisionStore}`.persistedOptions`. */
export const clientActionDecisionsPersistedOptions =
  outlookClientActionDecisionStore.persistedOptions;

/** The core merge bound to Outlook's action registry. */
export function mergeIntoStoredDecisions(
  stored: unknown,
  decisions: ClientActionDecisionMap,
): Record<string, unknown> {
  return mergeIntoStoredDecisionsFor(
    stored,
    decisions,
    isImplementedClientAction,
  );
}
