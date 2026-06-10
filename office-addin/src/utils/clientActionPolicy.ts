import { isImplementedClientAction } from "./outlookClientActions";

import type { OutlookClientAction } from "./outlookClientActions";
import type { PersistedStateOptions } from "@erato/frontend/library";

/**
 * Local decision store for client actions, pure and unit-testable.
 *
 * Browser-permission semantics: every action defaults to `ask` — the inline
 * card asks on each proposal, and "allow once" / "deny" on the card apply to
 * that proposal only. Only an explicit "always allow" persists (written by
 * the card or the settings page); `never` is a persistent deny set in
 * settings. The deployment config is the policy authority: actions listed in
 * the facet's `client_actions_always_ask` can never resolve to `always` —
 * a stored grant is clamped back to `ask`, and the UI greys the option out
 * with a reason. Users may always be STRICTER than the server (deny).
 */
export type ClientActionDecision = "ask" | "always" | "never";

/** Stored decisions, keyed by `decisionKey(facetId, action)`. */
export type ClientActionDecisionMap = Record<string, ClientActionDecision>;

export const CLIENT_ACTION_DECISIONS_KEY =
  "erato.outlookAddin.clientActionDecisions";

export const DEFAULT_CLIENT_ACTION_DECISIONS: ClientActionDecisionMap = {};

/**
 * Decisions are scoped per facet AND action: "always allow reply for the
 * read-mode facet" must not silently pre-grant a future facet that happens
 * to reuse the same action id.
 */
export function decisionKey(facetId: string, action: string): string {
  return `${facetId}/${action}`;
}

/**
 * Inverse of `decisionKey`. Facet ids are free-form erato.toml keys and may
 * themselves contain `/`; action ids never do, so the LAST separator is the
 * unambiguous split. Returns `null` when either side would be empty.
 */
export function parseDecisionKey(
  key: string,
): { facetId: string; action: string } | null {
  const separator = key.lastIndexOf("/");
  if (separator <= 0 || separator === key.length - 1) {
    return null;
  }
  return {
    facetId: key.slice(0, separator),
    action: key.slice(separator + 1),
  };
}

export function isClientActionDecision(
  value: unknown,
): value is ClientActionDecision {
  return value === "ask" || value === "always" || value === "never";
}

/**
 * The decision in effect for an action: the stored decision (default `ask`),
 * with a server-enforced per-use confirmation clamping `always` back to
 * `ask`. `never` is honored regardless — stricter than the server is fine.
 */
export function effectiveDecision(input: {
  facetId: string;
  action: OutlookClientAction;
  decisions: ClientActionDecisionMap;
  /** The facet's `client_actions_always_ask` from `GET /me/facets`. */
  enforcedAskActions: readonly string[];
}): ClientActionDecision {
  const stored =
    input.decisions[decisionKey(input.facetId, input.action)] ?? "ask";
  if (stored === "always" && input.enforcedAskActions.includes(input.action)) {
    return "ask";
  }
  return stored;
}

export function isActionDenied(
  input: Parameters<typeof effectiveDecision>[0],
): boolean {
  return effectiveDecision(input) === "never";
}

/** What an explicit button click does for an (offered, non-denied) action. */
export function resolveClickBehavior(
  input: Parameters<typeof effectiveDecision>[0],
): "execute" | "confirm" {
  return effectiveDecision(input) === "always" ? "execute" : "confirm";
}

export type AutoPromptBehavior = "execute" | "confirm" | "none";

/**
 * Whether (and how) a proposal may auto-surface without a click. Requires ALL
 * of: the facet configured `auto_prompt`, a validated proposal, a FRESH
 * assistant completion (never history reloads/refetches) that is still the
 * LATEST assistant message, and a send-time item identity that matches the
 * currently open item — a missing identity means capture failed and is
 * treated like a mismatch (fail closed: a missed auto-open, never a reply
 * form on the wrong email). The effective decision then applies: `never` →
 * nothing, `ask` (the default) → the inline card surfaces, `always`
 * (user-granted, not server-enforced-ask) → the action executes. Outlook's
 * own Send button remains the final gate in every path.
 */
export function resolveAutoPromptBehavior(input: {
  presentation: string | undefined;
  facetId: string | undefined;
  proposedAction: OutlookClientAction | undefined;
  isFreshCompletion: boolean;
  /** Whether the proposing message is the latest assistant message. */
  isLatestAssistantMessage: boolean;
  /** Send-time item identity stamped on the artifact, if capture succeeded. */
  expectedItemIdentity: string | null | undefined;
  /** Identity of the currently open Outlook item. */
  currentItemIdentity: string | null | undefined;
  decisions: ClientActionDecisionMap;
  enforcedAskActions: readonly string[];
}): AutoPromptBehavior {
  if (input.presentation !== "auto_prompt") {
    return "none";
  }
  if (!input.facetId || !input.proposedAction || !input.isFreshCompletion) {
    return "none";
  }
  if (!input.isLatestAssistantMessage) {
    return "none";
  }
  if (
    !input.expectedItemIdentity ||
    input.expectedItemIdentity !== input.currentItemIdentity
  ) {
    return "none";
  }
  const decision = effectiveDecision({
    facetId: input.facetId,
    action: input.proposedAction,
    decisions: input.decisions,
    enforcedAskActions: input.enforcedAskActions,
  });
  if (decision === "never") {
    return "none";
  }
  return decision === "always" ? "execute" : "confirm";
}

/**
 * Whether a stored entry is fully described by this build's model — an
 * implemented action with a known decision value. Only such entries belong
 * to the in-memory map; everything else (future actions, future decision
 * kinds, foreign key shapes) is preserved verbatim across writes.
 */
function isOwnedStoredEntry(key: string, decision: unknown): boolean {
  const parsed = parseDecisionKey(key);
  return (
    parsed !== null &&
    isImplementedClientAction(parsed.action) &&
    isClientActionDecision(decision)
  );
}

/**
 * Merge the in-memory map into the previously stored raw object: entries
 * this build owns are replaced wholesale (so removals stick), while unknown
 * entries survive the write — saving from an older build must never erase a
 * newer build's decisions (including persistent denies).
 */
export function mergeIntoStoredDecisions(
  stored: unknown,
  decisions: ClientActionDecisionMap,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  if (stored !== null && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [key, decision] of Object.entries(
      stored as Record<string, unknown>,
    )) {
      if (!isOwnedStoredEntry(key, decision)) {
        merged[key] = decision;
      }
    }
  }
  return Object.assign(merged, decisions);
}

function readStoredDecisionsRaw(): unknown {
  try {
    const raw = localStorage.getItem(CLIENT_ACTION_DECISIONS_KEY);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/**
 * Persisted-state options: unknown shapes reset to defaults; entries with
 * malformed keys, unknown decision values, or unimplemented actions are
 * dropped individually on read but survive writes via
 * `mergeIntoStoredDecisions` (forward compatible — a future build's entries
 * never invalidate the rest and are never erased by saving here). Server
 * enforcement is deliberately NOT applied here: it depends on live
 * `/me/facets` data and is clamped at read time by `effectiveDecision`, so a
 * temporarily unreachable backend can't silently erase a user's stored
 * grant.
 */
export const clientActionDecisionsPersistedOptions: PersistedStateOptions<ClientActionDecisionMap> =
  {
    parse: (value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }
      const result: ClientActionDecisionMap = {};
      for (const [key, decision] of Object.entries(
        value as Record<string, unknown>,
      )) {
        const parsed = parseDecisionKey(key);
        if (!parsed || !isImplementedClientAction(parsed.action)) {
          continue;
        }
        if (!isClientActionDecision(decision)) {
          continue;
        }
        // Storing the default is allowed but redundant; normalize it away.
        if (decision === "ask") {
          continue;
        }
        result[key] = decision;
      }
      return result;
    },
    serialize: (value) =>
      JSON.stringify(mergeIntoStoredDecisions(readStoredDecisionsRaw(), value)),
  };
