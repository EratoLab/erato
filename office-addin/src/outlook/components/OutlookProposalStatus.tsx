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
  /** The card's own buttons act: the answer holds several versions, or this card shows another. */
  leftToCard: (content: readonly ContentPart[] | undefined) => boolean,
): OutlookProposalState | undefined {
  return useChainedState<ProposalApplyResult>(messageId, (content) =>
    chainedProposalState<ProposalApplyResult>(content, actions, leftToCard),
  );
}

/** The decision waits in the chat, so the draft offers no second way to make it. */
export const outlookProposalPending = (
  state: OutlookProposalState | undefined,
): boolean => state?.kind === "waiting" || state?.kind === "applying";

/** One line under the draft: where the proposed reply or appointment stands. */
export function OutlookProposalStatus({
  state,
  kind,
  openedHere = false,
}: {
  state: OutlookProposalState;
  kind: "reply" | "appointment";
  /** The draft's own button opened the form, so "nothing was opened" would be untrue. */
  openedHere?: boolean;
}) {
  const nothingOpened =
    state.kind === "cancelled" ||
    (state.kind === "done" &&
      (state.result.status === "failed" ||
        state.result.status === "unavailable"));
  if (openedHere && nothingOpened) return null;
  return (
    <p
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
      if (state.result.reason === "stopped")
        return reply
          ? t({
              id: "officeAddin.outlook.proposal.stoppedReply",
              message: "Stopped. No reply was opened.",
            })
          : t({
              id: "officeAddin.outlook.proposal.stoppedAppointment",
              message: "Stopped. No appointment was opened.",
            });
      if (state.result.reason === "pane_gone")
        return reply
          ? t({
              id: "officeAddin.outlook.proposal.paneGoneReply",
              message: "No reply was opened: the Erato pane was closed.",
            })
          : t({
              id: "officeAddin.outlook.proposal.paneGoneAppointment",
              message: "No appointment was opened: the Erato pane was closed.",
            });
      if (reply && state.result.reason === "other_item")
        return t({
          id: "officeAddin.outlook.proposal.otherEmail",
          message: "No reply was opened: a different email is open now.",
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
