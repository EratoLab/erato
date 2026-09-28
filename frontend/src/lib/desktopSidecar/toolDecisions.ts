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

/** A tool without a stored decision runs, as it did before decisions existed. */
export const controlDecisionOf = (
  decision: ClientToolDecision | undefined,
): McpToolDecision =>
  decision === "never_allow" ? "never" : decision === "ask" ? "ask" : "allow";
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
