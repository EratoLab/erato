import { createContext, useContext } from "react";

/**
 * Set inside the chat's decision place. Its shell is the only frame there: a
 * card drawn inside it, the decision itself included, leaves its own frame and
 * inset out, or a slim pane pays a border and an inset on both sides per level.
 */
export const DecisionPlaceContext = createContext(false);

export const useInDecisionPlace = (): boolean =>
  useContext(DecisionPlaceContext);
