import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export type WaitingCallPart = Extract<
  ContentPart,
  { content_type: "client_tool_pending" }
>;

/**
 * The client tool call a message's turn waits on right now: the message's own
 * last `client_tool_pending` part, when it still ends the row or sits right
 * before the stop that carries its tasks' questions. An earlier marker
 * belongs to a call that already ended, so anything that names or acts on the
 * waiting call reads it here.
 */
export const waitingCallOf = (
  content: readonly ContentPart[],
): WaitingCallPart | undefined => {
  for (let index = content.length - 1; index >= 0; index--) {
    const part = content[index];
    if (part.content_type !== "client_tool_pending") continue;
    return index === content.length - 1 ||
      content[index + 1]?.content_type === "tool_approval_request"
      ? part
      : undefined;
  }
  return undefined;
};

/** The tool of the message's `tool_use` part for this call. */
export const toolNameOfCall = (
  content: readonly ContentPart[],
  toolCallId: string,
): string | undefined => {
  for (const part of content) {
    if (part.content_type === "tool_use" && part.tool_call_id === toolCallId)
      return part.tool_name;
  }
  return undefined;
};
