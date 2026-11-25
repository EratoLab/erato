import { t } from "@lingui/core/macro";

import {
  chainedProposalState,
  useChainedState,
} from "../../core/clientActions/chainedCall";

import type { ChainedCallState } from "../../core/clientActions/chainedCall";
import type { ProposalApplyResult } from "../../core/clientActions/proposalApply";
import type { ContentPart } from "@erato/frontend/library";

export type OutlookProposalState = ChainedCallState<ProposalApplyResult>;

/**
 * Where the server's call for the answer's proposed action stands, or undefined when Erato
 * proposed none of `actions` and the card's own buttons are the only way to act.
 */
export function useOutlookProposalState(
  messageId: string | undefined,
  actions: readonly string[],
  /** The answer holds several versions, so the user picks one with its button. */
  userPicks: (content: readonly ContentPart[] | undefined) => boolean,
): OutlookProposalState | undefined {
  return useChainedState<ProposalApplyResult>(messageId, (content) => {
    const state = chainedProposalState<ProposalApplyResult>(content, actions);
    return state && !userPicks(content) ? state : undefined;
  });
}

/** One line under the draft: where the proposed reply or appointment stands. */
export function OutlookProposalStatus({
  state,
  kind,
}: {
  state: OutlookProposalState;
  kind: "reply" | "appointment";
}) {
  return (
    <p
      role="status"
      className="mt-1 text-xs text-theme-fg-secondary"
      data-testid="outlook-proposal-status"
    >
      {outlookProposalStatusText(state, kind)}
    </p>
  );
}

function outlookProposalStatusText(
  state: OutlookProposalState,
  kind: "reply" | "appointment",
): string {
  const reply = kind === "reply";
  switch (state.kind) {
    case "waiting":
      return t({
        id: "officeAddin.outlook.proposal.waiting",
        message: "Waiting for your decision",
      });
    case "applying":
      return reply
        ? t({
            id: "officeAddin.outlook.proposal.openingReply",
            message: "Opening the reply…",
          })
        : t({
            id: "officeAddin.outlook.proposal.openingAppointment",
            message: "Opening the appointment…",
          });
    case "cancelled":
      return reply
        ? t({
            id: "officeAddin.outlook.proposal.deniedReply",
            message: "Denied. No reply was opened.",
          })
        : t({
            id: "officeAddin.outlook.proposal.deniedAppointment",
            message: "Denied. No appointment was opened.",
          });
    case "done":
      break;
  }
  switch (state.result.status) {
    case "applied":
      return reply
        ? t({
            id: "officeAddin.outlook.proposal.replyOpened",
            message: "Reply opened in Outlook.",
          })
        : t({
            id: "officeAddin.outlook.proposal.appointmentOpened",
            message: "Appointment opened in Outlook.",
          });
    case "unconfirmed":
      return reply
        ? t({
            id: "officeAddin.outlook.proposal.replyMaybeOpen",
            message: "The reply may already be open in Outlook.",
          })
        : t({
            id: "officeAddin.outlook.proposal.appointmentMaybeOpen",
            message: "The appointment may already be open in Outlook.",
          });
    case "needs_decision":
      return t({
        id: "officeAddin.outlook.proposal.waiting",
        message: "Waiting for your decision",
      });
    case "failed":
    case "unavailable":
      if (reply && state.result.reason === "other_item")
        return t({
          id: "officeAddin.outlook.proposal.otherEmail",
          message:
            "No reply was opened: another email is open than the one this reply was written for.",
        });
      return reply
        ? t({
            id: "officeAddin.outlook.proposal.replyNotOpened",
            message: "No reply was opened.",
          })
        : t({
            id: "officeAddin.outlook.proposal.appointmentNotOpened",
            message: "No appointment was opened.",
          });
  }
}
