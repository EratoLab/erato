import {
  WORD_SUBMIT_PLAN_ACTION,
  WORD_SUBMIT_PLAN_TOOL,
} from "./wordHistoryNames";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

// Kept apart from the review model: message rendering reads these for every
// chat, while the model loads only for chats written from Word.

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The message and the ones before it on its branch, oldest first. */
export function wordMessageLineage(
  messages: Readonly<Record<string, Message | undefined>>,
  messageId: string | undefined,
): Message[] {
  const lineage: Message[] = [];
  const seen = new Set<string>();
  let id = messageId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const message = messages[id];
    if (!message) break;
    lineage.unshift(message);
    id = message.previous_message_id;
  }
  return lineage;
}

/** A `submit_document_plan` call the host accepted; retries and failures are not. */
export function isAcceptedWordSubmission(part: ContentPart): boolean {
  if (
    part.content_type !== "tool_use" ||
    part.tool_name !== WORD_SUBMIT_PLAN_TOOL ||
    part.status !== "success" ||
    typeof part.tool_call_id !== "string" ||
    !part.tool_call_id
  )
    return false;
  const output = part.output;
  if (
    !object(output) ||
    output.status !== "success" ||
    !object(output.submission) ||
    output.submission.status !== "accepted" ||
    !object(output.result) ||
    !object(part.input)
  )
    return false;
  return (
    output.result.draft_id === part.tool_call_id &&
    output.result.snapshot === part.input.snapshot &&
    output.result.action === WORD_SUBMIT_PLAN_ACTION
  );
}

/** A `submit_document_plan` attempt that failed or that the host sent back for a retry. */
export function isRejectedWordSubmission(part: ContentPart): boolean {
  if (
    part.content_type !== "tool_use" ||
    part.tool_name !== WORD_SUBMIT_PLAN_TOOL
  )
    return false;
  const output = part.output;
  return (
    part.status === "error" ||
    (object(output) &&
      object(output.submission) &&
      typeof output.submission.status === "string" &&
      output.submission.status !== "accepted")
  );
}
