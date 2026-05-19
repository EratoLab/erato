import type {
  ContentPart,
  ToolUse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Interface representing a tool call for UI display
 */
export interface UiToolCall {
  id: string;
  name: string;
  status: "success" | "error" | "in_progress";
  input?: unknown;
  output?: unknown;
  progressMessage?: string;
}

/**
 * Extracts tool calls from ContentPart array
 * @param content Array of ContentPart objects
 * @returns Array of tool calls
 */
export function extractToolCallsFromContent(
  content?: ContentPart[] | null,
): UiToolCall[] {
  if (!content || !Array.isArray(content)) {
    return [];
  }

  return content
    .filter((part) => part.content_type === "tool_use")
    .map((part) => {
      const toolUse = part as ToolUse & { content_type: "tool_use" };
      if (!toolUse.tool_call_id || !toolUse.tool_name || !toolUse.status) {
        return null;
      }

      return {
        id: toolUse.tool_call_id,
        name: toolUse.tool_name,
        status: toolUse.status,
        input: toolUse.input,
        output: toolUse.output,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/prefer-nullish-coalescing
        progressMessage: toolUse.progress_message || undefined,
      } as UiToolCall;
    })
    .filter((toolCall): toolCall is UiToolCall => toolCall !== null);
}

/**
 * Checks if a message contains tool calls
 * @param content Array of ContentPart objects
 * @returns Boolean indicating if tool calls are present
 */
export function hasToolCalls(content?: ContentPart[] | null): boolean {
  if (!content || !Array.isArray(content)) {
    return false;
  }

  return content.some((part) => part.content_type === "tool_use");
}
