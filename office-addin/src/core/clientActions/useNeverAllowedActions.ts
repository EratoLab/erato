import { useApprovalTools, useProfile } from "@erato/frontend/library";
import { useMemo } from "react";

import { carryOverMappingsFor } from "./proposalApply";

/**
 * The host's actions whose server tool the user set to Never: the answer does not offer their
 * buttons either, so Never reads the same on every card.
 */
export function useNeverAllowedActions(namespace: string): ReadonlySet<string> {
  const tools = useApprovalTools();
  const { profile } = useProfile();
  const decisions = profile?.client_tool_decisions;
  return useMemo(
    () =>
      new Set(
        carryOverMappingsFor(tools, namespace).flatMap((mapping) =>
          decisions?.[mapping.serverKey] === "never_allow"
            ? mapping.actions
            : [],
        ),
      ),
    [tools, namespace, decisions],
  );
}
