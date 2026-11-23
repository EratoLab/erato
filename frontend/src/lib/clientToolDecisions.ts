import {
  fetchProfile,
  fetchUpdateProfilePreferences,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { McpToolDecision } from "@/components/ui/Settings/mcpToolDecisions";
import type { ClientToolDecision } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/* eslint-disable lingui/no-unlocalized-strings -- API enum values. */
export const clientToolDecisionOf = (
  decision: McpToolDecision,
): ClientToolDecision =>
  decision === "never"
    ? "never_allow"
    : decision === "allow"
      ? "always_allow"
      : "ask";

/**
 * The decision a tool row shows: the stored one, else what the server does
 * without one. A desktop tool without a stored decision runs, as it did
 * before decisions existed; a change the server applies asks.
 */
export const controlDecisionOf = (
  decision: ClientToolDecision | undefined,
  fallback: "allow" | "ask" = "allow",
): McpToolDecision =>
  decision === "never_allow"
    ? "never"
    : decision === "ask"
      ? "ask"
      : decision === "always_allow"
        ? "allow"
        : fallback;
/* eslint-enable lingui/no-unlocalized-strings */

/**
 * The endpoint replaces the whole map, so merge into the freshest copy rather
 * than a possibly stale cached profile.
 */
export async function saveClientToolDecision(
  qualifiedName: string,
  decision: ClientToolDecision,
): Promise<void> {
  const profile = await fetchProfile({});
  await fetchUpdateProfilePreferences({
    body: {
      client_tool_decisions: {
        ...profile.client_tool_decisions,
        [qualifiedName]: decision,
      },
    },
  });
}

/**
 * Adds decisions for tools that have none stored yet, in one save: a choice
 * already on the server wins. Returns the keys it added.
 */
export async function addUnsetClientToolDecisions(
  decisions: Readonly<Record<string, ClientToolDecision>>,
): Promise<string[]> {
  const profile = await fetchProfile({});
  const stored = profile.client_tool_decisions ?? {};
  const added = Object.keys(decisions).filter((key) => !(key in stored));
  if (added.length === 0) return added;
  await fetchUpdateProfilePreferences({
    body: {
      client_tool_decisions: {
        ...stored,
        ...Object.fromEntries(added.map((key) => [key, decisions[key]])),
      },
    },
  });
  return added;
}
