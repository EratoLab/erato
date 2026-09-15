import { t } from "@lingui/core/macro";

import type { McpServerTool } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * The two rosters a server's tools are shown in. Membership is a straight
 * read of the annotation class the backend normalized: only a tool the
 * server marked read-only is read-only; an unannotated tool is a write tool
 * under protocol defaults and keeps its "Not declared" pill to say so.
 */
export type McpToolGroupKey = "readOnly" | "write";

export const MCP_TOOL_GROUP_KEYS: readonly McpToolGroupKey[] = [
  // eslint-disable-next-line lingui/no-unlocalized-strings -- group key
  "readOnly",
  "write",
];

export interface McpToolGroup {
  key: McpToolGroupKey;
  tools: McpServerTool[];
}

/** Partitions the roster, in the order the groups are shown; keeps the
 * server's order inside each group. Empty groups are left out. */
export const groupMcpTools = (tools: McpServerTool[]): McpToolGroup[] => {
  const readOnly: McpServerTool[] = [];
  const write: McpServerTool[] = [];
  for (const tool of tools) {
    (tool.annotations.read_only_hint ? readOnly : write).push(tool);
  }
  const groups: McpToolGroup[] = [];
  if (readOnly.length > 0) {
    // eslint-disable-next-line lingui/no-unlocalized-strings -- group key
    groups.push({ key: "readOnly", tools: readOnly });
  }
  if (write.length > 0) {
    groups.push({ key: "write", tools: write });
  }
  return groups;
};

export const mcpToolGroupLabel = (key: McpToolGroupKey): string =>
  key === "readOnly"
    ? t({
        id: "preferences.dialog.mcpServers.tools.group.readOnly",
        message: "Read-only tools",
      })
    : t({
        id: "preferences.dialog.mcpServers.tools.group.write",
        message: "Write/delete tools",
      });
