/**
 * The `server/tool` spelling a chat's disabled-tool list holds. The
 * composer only ever writes exact entries; the backend also honors
 * `server/*`, but nothing here produces or reads one.
 */
export const mcpToolPattern = (serverId: string, toolName: string) =>
  `${serverId}/${toolName}`;

/** Splits a stored pattern back into its server id and tool name. */
export const parseMcpToolPattern = (
  pattern: string,
): { serverId: string; toolName: string } | null => {
  const separator = pattern.indexOf("/");
  if (separator <= 0 || separator === pattern.length - 1) {
    return null;
  }
  return {
    serverId: pattern.slice(0, separator),
    toolName: pattern.slice(separator + 1),
  };
};

export const isMcpToolDisabled = (
  patterns: readonly string[],
  serverId: string,
  toolName: string,
) => patterns.includes(mcpToolPattern(serverId, toolName));

/** How many of a server's tools the list switches off, by exact entry. */
export const countDisabledMcpTools = (
  patterns: readonly string[],
  serverId: string,
) =>
  patterns.filter(
    (pattern) => parseMcpToolPattern(pattern)?.serverId === serverId,
  ).length;
