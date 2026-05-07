import type {
  ContentPart,
  MessageSubmitStreamingResponseToolCallProposed,
  MessageSubmitStreamingResponseToolCallUpdate,
  ToolCallStatus,
  ToolUse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

type ToolUseContentPart = ToolUse & { content_type: "tool_use" };

const isToolUsePart = (part: ContentPart): part is ToolUseContentPart =>
  part.content_type === "tool_use";

const buildToolUsePart = (data: {
  toolCallId: string;
  toolName: string;
  status: ToolCallStatus;
  input?: ToolUse["input"];
  output?: ToolUse["output"];
  progressMessage?: string | null;
}): ToolUseContentPart =>
  ({
    content_type: "tool_use",
    tool_call_id: data.toolCallId,
    tool_name: data.toolName,
    status: data.status,
    input: data.input ?? null,
    output: data.output ?? null,
    progress_message: data.progressMessage ?? null,
  }) as ToolUseContentPart;

/**
 * Insert a freshly-proposed tool_use part into the content array at its
 * `content_index`. Treated as a new "in_progress" entry — the wire-level
 * `tool_call_proposed` event has no status field, but the canonical schema
 * only knows the three real statuses, so we seed with "in_progress" and let
 * the next `tool_call_update` refine it.
 *
 * If a tool_use with the same tool_call_id already exists (duplicate event),
 * the array is returned unchanged.
 */
export function insertProposedToolUse(
  currentContent: ContentPart[],
  responseData: MessageSubmitStreamingResponseToolCallProposed,
): ContentPart[] {
  const alreadyPresent = currentContent.some(
    (part) =>
      isToolUsePart(part) && part.tool_call_id === responseData.tool_call_id,
  );
  if (alreadyPresent) {
    return currentContent;
  }

  const newPart = buildToolUsePart({
    toolCallId: responseData.tool_call_id,
    toolName: responseData.tool_name,
    status: "in_progress",
    input: responseData.input ?? null,
  });

  const updated = [...currentContent];
  const index = responseData.content_index;
  if (index >= updated.length) {
    updated.push(newPart);
  } else {
    updated.splice(index, 0, newPart);
  }
  return updated;
}

/**
 * Apply a tool_call_update to the content array. Looks up the existing
 * tool_use part by `tool_call_id` (stable identity). If not found (out-of-
 * order events), inserts a new tool_use at `content_index`.
 */
export function applyToolUseUpdate(
  currentContent: ContentPart[],
  responseData: MessageSubmitStreamingResponseToolCallUpdate,
): ContentPart[] {
  const updated = [...currentContent];
  const existingIndex = updated.findIndex(
    (part) =>
      isToolUsePart(part) && part.tool_call_id === responseData.tool_call_id,
  );

  if (existingIndex >= 0) {
    const existing = updated[existingIndex] as ToolUseContentPart;
    updated[existingIndex] = buildToolUsePart({
      toolCallId: responseData.tool_call_id,
      toolName: responseData.tool_name,
      status: responseData.status,
      input: responseData.input ?? existing.input ?? null,
      output: responseData.output ?? null,
      progressMessage: responseData.progress_message ?? null,
    });
    return updated;
  }

  const newPart = buildToolUsePart({
    toolCallId: responseData.tool_call_id,
    toolName: responseData.tool_name,
    status: responseData.status,
    input: responseData.input ?? null,
    output: responseData.output ?? null,
    progressMessage: responseData.progress_message ?? null,
  });
  const index = responseData.content_index;
  if (index >= updated.length) {
    updated.push(newPart);
  } else {
    updated.splice(index, 0, newPart);
  }
  return updated;
}
