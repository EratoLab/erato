import {
  sanitizeHtmlPreview,
  useConversationMessage,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useMemo } from "react";

import {
  OUTLOOK_PROPOSAL_TOOLS,
  outlookAppointmentDraft,
  outlookEmailDraft,
} from "../utils/outlookProposalApply";
import { getReadModeRecipientSummary } from "../utils/outlookReadReply";

import type { AppointmentDetails } from "../utils/outlookCreateAppointment";
import type { ApprovalItemCardProps } from "@erato/frontend/library";

/** The pane's Outlook namespace, as the server names its tools' requests. */
const OUTLOOK_NAMESPACE = "outlook";
const PROPOSAL_TOOLS = new Set(Object.values(OUTLOOK_PROPOSAL_TOOLS));

/**
 * A proposed Outlook action the server carries out, in the chat's decision place: what the reply
 * or appointment will hold, above the usual decisions. Anything else gets the generic card.
 */
export function OutlookApprovalItemCard(props: ApprovalItemCardProps) {
  const { item, serverId, status, renderDefault } = props;
  if (
    serverId !== OUTLOOK_NAMESPACE ||
    !item.chained ||
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
  const note = useMemo(() => {
    if (appointment) {
      const draft = outlookAppointmentDraft(content);
      return "details" in draft ? (
        <AppointmentPreview details={draft.details} />
      ) : null;
    }
    const draft = outlookEmailDraft(content, artifact);
    if ("missing" in draft) return null;
    const replyAll =
      item.tool_name === OUTLOOK_PROPOSAL_TOOLS["outlook.reply_all"];
    return (
      <ReplyPreview
        content={draft.content}
        isHtml={draft.isHtml}
        replyAll={replyAll}
      />
    );
  }, [appointment, content, artifact, item.tool_name]);
  return <>{renderDefault(note ? { note } : undefined)}</>;
}

function ReplyPreview({
  content,
  isHtml,
  replyAll,
}: {
  content: string;
  isHtml: boolean;
  replyAll: boolean;
}) {
  // Read from the email open now: the reply form takes its recipients from it.
  const summary = getReadModeRecipientSummary();
  const entries = summary
    ? [
        ...(summary.sender ? [summary.sender] : []),
        ...(replyAll ? summary.recipients : []),
      ]
    : [];
  const html = useMemo(
    () => (isHtml ? sanitizeHtmlPreview(content) : null),
    [content, isHtml],
  );
  return (
    <div className="space-y-2" data-testid="outlook-proposal-reply">
      {entries.length > 0 && (
        <p className="break-words text-xs text-theme-fg-secondary">
          {t({ id: "officeAddin.proposal.replyTo", message: "To:" })}{" "}
          {entries.join(", ")}
        </p>
      )}
      {html !== null ? (
        <div
          className="max-h-48 overflow-auto text-sm [&_p]:my-1"
          // Sanitized with DOMPurify before rendering.
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="max-h-48 overflow-auto whitespace-pre-wrap text-sm">
          {content}
        </div>
      )}
      <p className="text-xs text-theme-fg-secondary">
        {t({
          id: "officeAddin.proposal.replyNotSent",
          message:
            "This opens a prefilled reply. Nothing is sent until you press Send in Outlook.",
        })}
      </p>
    </div>
  );
}

const formatTime = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
};

function AppointmentPreview({ details }: { details: AppointmentDetails }) {
  const attendees = [
    ...details.attendees,
    ...(details.optionalAttendees ?? []),
  ];
  return (
    <div
      className="space-y-1 text-sm"
      data-testid="outlook-proposal-appointment"
    >
      <p className="font-medium text-theme-fg-primary [overflow-wrap:anywhere]">
        {details.subject}
      </p>
      <p className="text-theme-fg-secondary">
        {formatTime(details.start)} – {formatTime(details.end)}
      </p>
      {details.location ? (
        <p className="text-theme-fg-secondary [overflow-wrap:anywhere]">
          {details.location}
        </p>
      ) : null}
      {attendees.length > 0 && (
        <p className="break-words text-xs text-theme-fg-secondary">
          {attendees.join(", ")}
        </p>
      )}
      <p className="text-xs text-theme-fg-secondary">
        {t({
          id: "officeAddin.proposal.appointmentNotSent",
          message:
            "This opens a prefilled appointment. Nothing is saved or sent until you do it in Outlook.",
        })}
      </p>
    </div>
  );
}
