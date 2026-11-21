import { t } from "@lingui/core/macro";

import { WORD_SUBMIT_COMMENT_CHANGES_TOOL } from "@/lib/wordReview/wordCommentChanges";
import { WORD_READ_COMMENTS_TOOL } from "@/lib/wordReview/wordCommentContext";
import {
  WORD_READ_TOOL,
  WORD_SUBMIT_PLAN_TOOL,
} from "@/lib/wordReview/wordHistoryNames";

import { Alert } from "../Feedback/Alert";

import type {
  ContentPart,
  SubmissionOutcome,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { UiChatMessage } from "@/utils/adapters/messageAdapter";

const WORD_TOOLS = new Set([
  WORD_READ_TOOL,
  WORD_SUBMIT_PLAN_TOOL,
  WORD_READ_COMMENTS_TOOL,
  WORD_SUBMIT_COMMENT_CHANGES_TOOL,
]);

function latestOutcome(message: UiChatMessage): SubmissionOutcome | undefined {
  if (message.status !== "sending" && message.submission_outcome) {
    return message.submission_outcome;
  }
  for (const part of [...message.content].reverse()) {
    if (part.content_type !== "tool_use") continue;
    const output = part.output as {
      submission_outcome?: SubmissionOutcome;
    } | null;
    if (output?.submission_outcome) return output.submission_outcome;
  }
  return message.submission_outcome;
}

type WordCallEnd = "no-response" | "no-request-session";

/**
 * How the message's last Word call ended, when Word was not there to answer it: no pane answered
 * (asleep, in the background or closed), or the pane had no session for this request (it
 * reloaded, a newer request replaced this one, or the request was not sent with the document).
 */
function wordCallEnd(content: ContentPart[]): WordCallEnd | undefined {
  const part = [...content]
    .reverse()
    .find(
      (part): part is Extract<ContentPart, { content_type: "tool_use" }> =>
        part.content_type === "tool_use" &&
        WORD_TOOLS.has(part.tool_name ?? ""),
    );
  const output = part?.output as {
    status?: string;
    reason?: string;
    validation_errors?: { code?: string }[];
    submission_feedback?: { recovery?: string };
  } | null;
  if (!output) return undefined;
  if (
    output.status === "cancelled" &&
    (output.reason === "timeout" ||
      output.reason === "expired" ||
      output.reason === "context_unavailable")
  )
    return "no-response";
  if (
    output.submission_feedback?.recovery === "cannot_continue" &&
    output.validation_errors?.some(({ code }) =>
      ["wrong-request", "read-unavailable", "comments-unavailable"].includes(
        code ?? "",
      ),
    )
  )
    return "no-request-session";
  return undefined;
}

function noRequestSessionText(): string {
  return t({
    id: "chat.submission.word.noRequestSession",
    message:
      "The Word pane was reloaded, a newer request replaced this one, or this message wasn't sent with the document; send your request again from the Word pane.",
  });
}

function reasonText(
  reason: SubmissionOutcome["reason"],
  message: UiChatMessage,
): string {
  const end =
    reason === "timeout" || reason === "context_unavailable"
      ? wordCallEnd(message.content)
      : undefined;
  if (end === "no-response")
    return t({
      id: "chat.submission.word.noResponse",
      message: "Word didn't respond; keep Word open and send again.",
    });
  if (end === "no-request-session") return noRequestSessionText();
  switch (reason) {
    case "attempts_exhausted":
      return t`The correction attempts were exhausted.`;
    case "recovery_reads_exhausted":
      return t`The recovery read limit was reached.`;
    case "part_calls_exhausted":
      return t({
        id: "chat.submission.partCallsExhausted",
        message:
          "Erato reached the limit of parts it can write in one request; ask for a smaller change.",
      });
    case "user_requested_answer":
      return t`You chose to finish without further corrections.`;
    case "user_stopped":
    case "cancelled":
      return t`The correction was cancelled.`;
    case "timeout":
      return t`The host did not return a result in time.`;
    case "context_unavailable":
      return t`The source context is no longer available for this request.`;
    case "capability_unavailable":
      return t`The required submission capability is unavailable.`;
    case "provider_error":
      return t`A model or context limit prevented further correction.`;
    case "terminal_validation":
      return t`The host could not continue validating this proposal.`;
    default:
      return t`The model stopped without an accepted proposal.`;
  }
}

export function SubmissionNotice({ message }: { message: UiChatMessage }) {
  const outcome = latestOutcome(message);
  if (!outcome) {
    // Reads before any proposal have no submission outcome, and the model still answers after
    // them, sometimes without needing the document.
    const end =
      message.status !== "sending" ? wordCallEnd(message.content) : undefined;
    if (!end) return null;
    return (
      <Alert
        type="warning"
        geometryVariant="message"
        className="mb-3"
        data-testid="submission-unresolved"
      >
        {end === "no-response"
          ? t({
              id: "chat.submission.word.readNoResponse",
              message:
                "Erato couldn't read the document because Word didn't respond. If the answer needs it, keep Word open and send again.",
            })
          : noRequestSessionText()}
      </Alert>
    );
  }
  if (outcome.status === "accepted") return null;
  if (outcome.status === "correcting") {
    const attempt = Math.min(outcome.attempts_used + 1, outcome.max_attempts);
    const total = outcome.max_attempts;
    return (
      <Alert
        type="info"
        role="status"
        geometryVariant="message"
        className="mb-3"
        data-testid="submission-progress"
      >
        {t`Correcting changes · attempt ${attempt} of ${total}`}
      </Alert>
    );
  }
  return (
    <Alert
      type="warning"
      geometryVariant="message"
      className="mb-3"
      data-testid="submission-unresolved"
      title={t`No valid proposal was prepared`}
    >
      {reasonText(outcome.reason, message)}
    </Alert>
  );
}
