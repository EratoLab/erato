import {
  parseAppointmentDetails,
  isCreateAppointmentSupported,
  openNewAppointmentForm,
} from "./outlookCreateAppointment";
import { ReplyBodyTooLargeError, openReplyForm } from "./outlookReadReply";
import {
  answerFences,
  proposalOnceByCallId,
  sameItem,
} from "../../core/clientActions/proposalApply";

import type {
  OutlookClientAction,
  OutlookEmailClientAction,
  OutlookHostArtifact,
} from "./outlookClientActions";
import type { AppointmentDetails } from "./outlookCreateAppointment";
import type {
  AnswerFence,
  ProposalApplyResult,
} from "../../core/clientActions/proposalApply";
import type { ClientToolExecutor, ContentPart } from "@erato/frontend/library";

/** The server's tools for Outlook's proposed actions, by the action each carries out. */
export const OUTLOOK_PROPOSAL_TOOLS: Readonly<
  Record<OutlookClientAction, string>
> = {
  "outlook.reply": "open_reply",
  "outlook.reply_all": "open_reply_all",
  "outlook.create_appointment": "open_appointment",
};

/** What the executors read of the open pane: the chat's answers and the open item. */
export interface OutlookProposalBridge {
  /** The identity of the Outlook item open now. */
  itemIdentity: () => string | null;
  message: (messageId: string) =>
    | {
        content: readonly ContentPart[] | undefined;
        artifact: OutlookHostArtifact | undefined;
        /** The item open when the user sent the request this answer is for. */
        sendItemIdentity: string | undefined;
        latest: boolean;
      }
    | undefined;
}

const EMAIL_FENCES = new Set(["erato-email", "erato-email-html"]);
// The tags newer models drift to; read only for a facet that asked for an email body.
const DRIFTED_EMAIL_FENCES = new Set([
  "",
  "email",
  "erato",
  "erato-email-text",
  "text",
  "plaintext",
  "plain",
  "html",
]);
const MARKUP = /<\/?(?:p|br|div|span|ul|ol|li|b|strong|i|em|a|table|h\d)\b/i;

export type OutlookDraft =
  | { content: string; isHtml: boolean }
  | { missing: "not_found" | "ambiguous" };

/** The answer's email draft, as the email card shows it. */
export function outlookEmailDraft(
  content: readonly ContentPart[] | undefined,
  artifact: OutlookHostArtifact | undefined,
): OutlookDraft {
  const fences = answerFences(content);
  const tagged = fences.filter((fence) => EMAIL_FENCES.has(fence.language));
  const candidates: AnswerFence[] = tagged.length
    ? tagged
    : artifact?.bodyFormat
      ? fences.filter((fence) =>
          DRIFTED_EMAIL_FENCES.has(fence.language.toLowerCase()),
        )
      : [];
  if (candidates.length > 1) return { missing: "ambiguous" };
  const [fence] = candidates;
  if (fence) {
    const wantsHtml =
      fence.language === "erato-email-html" || artifact?.bodyFormat === "html";
    return {
      content: fence.body,
      isHtml: wantsHtml && MARKUP.test(fence.body),
    };
  }
  // The whole answer is the draft when the model wrote it with no fence at all.
  const text = (content ?? [])
    .flatMap((part) => (part.content_type === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();
  if (
    artifact?.renderMode === "body" &&
    artifact.bodyFormat &&
    artifact.shouldRenderEmailCard !== false &&
    fences.length === 0 &&
    text
  )
    return {
      content: text,
      isHtml: artifact.bodyFormat === "html" && MARKUP.test(text),
    };
  return { missing: "not_found" };
}

export type OutlookAppointmentDraft =
  | { details: AppointmentDetails }
  | { missing: "not_found" | "ambiguous" };

/** The answer's appointment, as the appointment card shows it. */
export function outlookAppointmentDraft(
  content: readonly ContentPart[] | undefined,
): OutlookAppointmentDraft {
  const fences = answerFences(content).filter(
    (fence) => fence.language === "erato-appointment",
  );
  if (fences.length > 1) return { missing: "ambiguous" };
  const details = fences[0] && parseAppointmentDetails(fences[0].body);
  return details ? { details } : { missing: "not_found" };
}

const isEmailAction = (action: string): action is OutlookEmailClientAction =>
  action === "outlook.reply" || action === "outlook.reply_all";

/**
 * The server's call for a proposed Outlook action: it opens the reply form or the new-appointment
 * form with the answer's draft, as the card's button does. Nothing is ever sent; the user sends
 * from Outlook's own form. A reply opens only on the email the answer was made for.
 */
export function createOutlookProposalExecutor(
  tool: string,
  bridge: () => OutlookProposalBridge | null,
): ClientToolExecutor {
  return proposalOnceByCallId(
    async (input, context): Promise<ProposalApplyResult> => {
      if (OUTLOOK_PROPOSAL_TOOLS[input.action as OutlookClientAction] !== tool)
        return { status: "failed", reason: "invalid_input" };
      const host = bridge();
      if (!host) return { status: "unavailable", reason: "no_pane" };
      const message = host.message(context.messageId);
      if (!message) return { status: "unavailable", reason: "no_message" };
      if (!message.latest)
        return { status: "unavailable", reason: "not_latest" };
      if (isEmailAction(input.action)) {
        const expected =
          input.itemIdentity ??
          message.artifact?.itemIdentity ??
          message.sendItemIdentity;
        if (!sameItem(expected, host.itemIdentity()))
          return { status: "unavailable", reason: "other_item" };
        const draft = outlookEmailDraft(message.content, message.artifact);
        if ("missing" in draft)
          return { status: "failed", reason: draft.missing };
        try {
          await openReplyForm(input.action, draft.content, draft.isHtml);
          return { status: "applied" };
        } catch (error) {
          return {
            status: "failed",
            reason:
              error instanceof ReplyBodyTooLargeError
                ? "too_large"
                : "host_error",
          };
        }
      }
      // The appointment lives whole in the answer and its form opens on the mailbox, not on the
      // open item, so it cannot land on the wrong email.
      const draft = outlookAppointmentDraft(message.content);
      if ("missing" in draft)
        return { status: "failed", reason: draft.missing };
      if (!isCreateAppointmentSupported())
        return { status: "unavailable", reason: "not_supported" };
      try {
        await openNewAppointmentForm(draft.details);
        return { status: "applied" };
      } catch {
        return { status: "failed", reason: "host_error" };
      }
    },
  );
}

let current: OutlookProposalBridge | null = null;

export function setOutlookProposalBridge(
  bridge: OutlookProposalBridge | null,
): void {
  current = bridge;
}

export function outlookProposalBridge(): OutlookProposalBridge | null {
  return current;
}
