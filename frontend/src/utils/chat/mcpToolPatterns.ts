/**
 * The `server/tool` spelling the composer writes into a chat's
 * disabled-tool list. The list's grammar is wider than what the composer
 * writes: the backend also honors `*`, a bare `server` and `server/*`, and
 * the readers here mirror that so the UI never shows a tool as on that the
 * generation withholds.
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

/**
 * Whether the entry names exactly one tool — the only shape the composer
 * writes, and so the only one it can remove again.
 */
export const isExactMcpToolPattern = (pattern: string) =>
  pattern !== "*" &&
  pattern.includes("/") &&
  !pattern.endsWith("/*") &&
  parseMcpToolPattern(pattern) !== null;

// Mirrors the backend's qualified-name matcher: `*` covers everything, a
// bare `server` its every tool, `prefix/*` every qualified name under the
// prefix (which may itself contain slashes), anything else is exact.
const mcpPatternMatches = (
  pattern: string,
  serverId: string,
  toolName: string,
) => {
  if (pattern === "*") {
    return true;
  }
  if (!pattern.includes("/")) {
    return pattern === serverId;
  }
  const qualifiedName = mcpToolPattern(serverId, toolName);
  if (pattern.endsWith("/*")) {
    return qualifiedName.startsWith(pattern.slice(0, -1));
  }
  return pattern === qualifiedName;
};

export const isMcpToolDisabled = (
  patterns: readonly string[],
  serverId: string,
  toolName: string,
) => patterns.some((pattern) => mcpPatternMatches(pattern, serverId, toolName));

/**
 * The first entry that switches the tool off without naming it exactly, if
 * any. Such an entry is out of the composer's reach: flipping the tool only
 * adds or removes its exact entry, so the tool would stay off regardless.
 */
export const mcpToolCoveringPattern = (
  patterns: readonly string[],
  serverId: string,
  toolName: string,
) =>
  patterns.find(
    (pattern) =>
      !isExactMcpToolPattern(pattern) &&
      mcpPatternMatches(pattern, serverId, toolName),
  ) ?? null;

/**
 * How much of a server the list switches off: `"all"` when an entry covers
 * the server as a whole, `"some"` when a wildcard reaches into it without
 * a roster to count against, otherwise the number of exact entries.
 */
export type DisabledMcpToolCount = "all" | "some" | number;

export const countDisabledMcpTools = (
  patterns: readonly string[],
  serverId: string,
): DisabledMcpToolCount => {
  let exactCount = 0;
  let partial = false;
  for (const pattern of patterns) {
    if (
      pattern === "*" ||
      pattern === serverId ||
      pattern === `${serverId}/*`
    ) {
      return "all";
    }
    if (parseMcpToolPattern(pattern)?.serverId !== serverId) {
      continue;
    }
    if (isExactMcpToolPattern(pattern)) {
      exactCount += 1;
    } else {
      partial = true;
    }
  }
  return partial ? "some" : exactCount;
};
