import { registerClientToolExecutor } from "@erato/frontend/library";
import { useEffect, useRef } from "react";

import {
  createOutlookProposalExecutor,
  OUTLOOK_PROPOSAL_TOOLS,
  outlookProposalBridge,
  setOutlookProposalBridge,
  type OutlookProposalBridge,
} from "../utils/outlookProposalApply";

/**
 * Registers the executors of the server's calls for proposed Outlook actions: open a reply,
 * reply all, or a new appointment from the answer's draft once the user decided in the chat.
 */
export function useOutlookProposalTools(
  bridge: () => OutlookProposalBridge,
): void {
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  useEffect(() => {
    setOutlookProposalBridge({
      itemIdentity: () => bridgeRef.current().itemIdentity(),
      message: (messageId) => bridgeRef.current().message(messageId),
    });
    const unregister = Object.values(OUTLOOK_PROPOSAL_TOOLS).map((tool) =>
      registerClientToolExecutor(
        tool,
        createOutlookProposalExecutor(tool, outlookProposalBridge),
      ),
    );
    return () => {
      unregister.forEach((dispose) => dispose());
      setOutlookProposalBridge(null);
    };
  }, []);
}
