import { useHostArtifact } from "@erato/frontend/library";
import { useCallback, useMemo, useState } from "react";

import { useClientActionDecisions } from "../../core/clientActions/useClientActionDecisions";
import { useWordWrite } from "../providers/WordWriteProvider";
import {
  decisionKey,
  grantClientActionForSession,
  scopedDecisions,
  wordClientActionDecisionStore,
} from "../utils/clientActionPolicy";

import type {
  ClientActionDecisionMap,
  ClientActionGrantScope,
} from "../utils/clientActionPolicy";

/**
 * A Word card's decisions for its action as the facet's grant_scope reaches them (O-25): a
 * session-scoped action sees only this session's grant for the open document, and its "Always
 * allow" is kept there instead of on the device.
 */
export function useWordClientActionDecisions(action: string): {
  decisions: ClientActionDecisionMap;
  setDecisions: (value: ClientActionDecisionMap | null) => void;
  grantAlways: () => void;
  grantScope: ClientActionGrantScope;
} {
  const artifact = useHostArtifact();
  const { documentIdentity } = useWordWrite();
  const [stored, setDecisions] = useClientActionDecisions(
    wordClientActionDecisionStore,
  );
  const [grants, setGrants] = useState(0);
  const facetId = artifact?.facetId ?? "";
  const grantScope: ClientActionGrantScope =
    artifact?.clientActionGrantScopes?.[action] === "session_document"
      ? "session_document"
      : "device";
  const decisions = useMemo(
    () =>
      scopedDecisions(stored, {
        facetId,
        action,
        scope: grantScope,
        identity: documentIdentity,
      }),
    // `grants` re-reads the session store after this card granted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stored, facetId, action, grantScope, documentIdentity, grants],
  );
  const grantAlways = useCallback(() => {
    if (grantScope === "session_document") {
      if (documentIdentity)
        grantClientActionForSession(facetId, action, documentIdentity);
      setGrants((n) => n + 1);
    } else
      setDecisions({ ...stored, [decisionKey(facetId, action)]: "always" });
  }, [grantScope, documentIdentity, facetId, action, stored, setDecisions]);
  return { decisions, setDecisions, grantAlways, grantScope };
}
