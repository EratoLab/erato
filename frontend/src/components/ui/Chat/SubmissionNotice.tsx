import { t } from "@lingui/core/macro";

import { Alert } from "../Feedback/Alert";

import type { SubmissionOutcome } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { UiChatMessage } from "@/utils/adapters/messageAdapter";

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

function reasonText(reason: SubmissionOutcome["reason"]): string {
  switch (reason) {
    case "attempts_exhausted":
      return t`The correction attempts were exhausted.`;
    case "recovery_reads_exhausted":
      return t`The recovery read limit was reached.`;
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
    case "work_limit_reached":
      return t`The work limit was reached.`;
    default:
      return t`The model stopped without an accepted proposal.`;
  }
}

export function SubmissionNotice({ message }: { message: UiChatMessage }) {
  const outcome = latestOutcome(message);
  if (!outcome || outcome.status === "accepted") return null;
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
      {reasonText(outcome.reason)}
    </Alert>
  );
}
