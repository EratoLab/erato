import { useConversationMessage } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useMemo } from "react";

import {
  OUTLOOK_PROPOSAL_TOOLS,
  outlookAppointmentDraft,
  outlookEmailDraft,
} from "../utils/outlookProposalApply";
import { getReadModeRecipientSummary } from "../utils/outlookReadReply";

import type { ApprovalItemCardProps } from "@erato/frontend/library";

/** The pane's Outlook namespace, as the server names its tools' requests. */
const OUTLOOK_NAMESPACE = "outlook";
const PROPOSAL_TOOLS = new Set(Object.values(OUTLOOK_PROPOSAL_TOOLS));

/**
 * A proposed Outlook action the server carries out, in the chat's decision place: who the reply
 * goes to and that it opens the draft above, over the usual decisions. Anything else gets the
 * generic card.
 */
export function OutlookApprovalItemCard(props: ApprovalItemCardProps) {
  const { item, serverId, status, renderDefault } = props;
  if (
    serverId !== OUTLOOK_NAMESPACE ||
    !item.follows ||
    !PROPOSAL_TOOLS.has(item.tool_name) ||
    status !== "pending"
  )
    return <>{renderDefault()}</>;
  return <OutlookProposalCard {...props} />;
}

function OutlookProposalCard({
  item,
  messageId,
  renderDefault,
}: ApprovalItemCardProps) {
  const message = useConversationMessage(messageId);
  const content = message?.content;
  const artifact = message?.hostArtifact;
  const appointment =
    item.tool_name === OUTLOOK_PROPOSAL_TOOLS["outlook.create_appointment"];
  // The draft is in the answer right above; the card names what the draft does not show.
  const found = useMemo(
    () =>
      !(
        "missing" in
        (appointment
          ? outlookAppointmentDraft(content)
          : outlookEmailDraft(content, artifact))
      ),
    [appointment, content, artifact],
  );
  if (!found) return <>{renderDefault()}</>;
  const note = appointment ? (
    <p
      className="text-xs text-theme-fg-secondary"
      data-testid="outlook-proposal-appointment"
    >
      {t({
        id: "officeAddin.proposal.appointmentFromDraft",
        message:
          "This opens the appointment above in Outlook. Nothing is saved or sent until you do it there.",
      })}
    </p>
  ) : (
    <ReplyNote
      replyAll={item.tool_name === OUTLOOK_PROPOSAL_TOOLS["outlook.reply_all"]}
    />
  );
  return <>{renderDefault({ note })}</>;
}

function ReplyNote({ replyAll }: { replyAll: boolean }) {
  // Read from the email open now: the reply form takes its recipients from it.
  const summary = getReadModeRecipientSummary();
  const entries = summary
    ? [
        ...(summary.sender ? [summary.sender] : []),
        ...(replyAll ? summary.recipients : []),
      ]
    : [];
  return (
    <div className="space-y-1" data-testid="outlook-proposal-reply">
      {entries.length > 0 && (
        <p className="break-words text-xs text-theme-fg-secondary">
          {t({ id: "officeAddin.proposal.replyTo", message: "To:" })}{" "}
          {entries.join(", ")}
        </p>
      )}
      <p className="text-xs text-theme-fg-secondary">
        {t({
          id: "officeAddin.proposal.replyFromDraft",
          message:
            "This opens the draft above as a reply. Nothing is sent until you press Send in Outlook.",
        })}
      </p>
    </div>
  );
}
