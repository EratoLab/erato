import { t } from "@lingui/core/macro";
import { useState } from "react";

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

/** One line under the draft: where the proposed reply or appointment stands. */
export function OutlookProposalStatus({
  state,
  kind,
  openedHere = false,
}: {
  state: OutlookProposalState;
  kind: "reply" | "appointment";
  /** A form for this answer was opened in this pane, so "nothing was opened" could be untrue. */
  openedHere?: boolean;
}) {
  const text = outlookProposalStatusText(state, kind);
  // Announced only when it changes, so past answers stay silent; the decision card that would
  // have said the outcome is gone once decided.
  const [shownFirst] = useState(text);
  const nothingOpened =
    state.kind === "cancelled" ||
    (state.kind === "done" &&
      (state.result.status === "failed" ||
        state.result.status === "unavailable"));
  if (openedHere && nothingOpened) return null;
  return (
    <>
      <p
        className="mt-1 text-xs text-theme-fg-secondary"
        data-testid="outlook-proposal-status"
      >
        {text}
      </p>
      <p role="status" className="sr-only">
        {text === shownFirst ? "" : text}
      </p>
    </>
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
      if (reply && state.result.reason === "too_large")
        return t({
          id: "officeAddin.emailRenderer.replyTooLarge",
          message:
            "Draft is too large to prefill a reply. Use Copy and paste it into a reply instead.",
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
