import { isRecord } from "./serverText";

import type { ToolUse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * The tool a call ran, as its server names it. The model calls an MCP tool
 * by a name qualified with its server when another server or one of Erato's
 * own tools has the same name; the call's display then carries the tool's
 * own name, which is the one to show.
 */
export const shownToolName = (
  part: Pick<ToolUse, "tool_name" | "display">,
): string => {
  const display: unknown = part.display;
  const own =
    isRecord(display) && typeof display.tool_name === "string"
      ? display.tool_name
      : "";
  return own.length > 0 ? own : (part.tool_name ?? "");
};
