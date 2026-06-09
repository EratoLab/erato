import {
  IMPLEMENTED_CLIENT_ACTIONS,
  type OutlookClientAction,
} from "./outlookClientActions";

import type { PersistedStateOptions } from "@erato/frontend/library";

/**
 * Local approval policy for client actions, pure and unit-testable.
 *
 * Two inputs combine into the effective behavior:
 * - the facet's server-side `presentation` (`render_buttons` | `auto_prompt`)
 *   from `GET /me/facets`, and
 * - the user's local per-action preference below.
 *
 * The local preference can always make behavior STRICTER than the server
 * intent (deny an action, force a confirmation), never more permissive than
 * the per-action floor allows.
 */
export type ClientActionApprovalMode = "always_ask" | "dont_ask" | "deny";

export type ClientActionPreferences = Record<
  OutlookClientAction,
  ClientActionApprovalMode
>;

export const CLIENT_ACTION_PREFERENCES_KEY =
  "erato.outlookAddin.clientActionPreferences";

/**
 * Defaults reproduce the pre-settings behavior exactly: reply executes on
 * click, reply-all confirms first.
 */
export const DEFAULT_CLIENT_ACTION_PREFERENCES: ClientActionPreferences = {
  "outlook.reply": "dont_ask",
  "outlook.reply_all": "always_ask",
};

/**
 * Per-action strictness floors local settings cannot go below. Reply-all is
 * floored at `always_ask`: the confirmation doubles as the fresh-recipient
 * check, so it can be denied but never made silent.
 */
const APPROVAL_FLOORS: Partial<
  Record<OutlookClientAction, ClientActionApprovalMode>
> = {
  "outlook.reply_all": "always_ask",
};

const STRICTNESS: Record<ClientActionApprovalMode, number> = {
  dont_ask: 0,
  always_ask: 1,
  deny: 2,
};

export function isApprovalMode(
  value: unknown,
): value is ClientActionApprovalMode {
  return value === "always_ask" || value === "dont_ask" || value === "deny";
}

/** The user's preference for an action, clamped to the action's floor. */
export function effectiveApprovalMode(
  action: OutlookClientAction,
  preferences: ClientActionPreferences,
): ClientActionApprovalMode {
  const preferred =
    preferences[action] ?? DEFAULT_CLIENT_ACTION_PREFERENCES[action];
  const floor = APPROVAL_FLOORS[action];
  if (floor && STRICTNESS[preferred] < STRICTNESS[floor]) {
    return floor;
  }
  return preferred;
}

export function isActionDenied(
  action: OutlookClientAction,
  preferences: ClientActionPreferences,
): boolean {
  return effectiveApprovalMode(action, preferences) === "deny";
}

/** What an explicit button click does for an (offered, non-denied) action. */
export function resolveClickBehavior(
  action: OutlookClientAction,
  preferences: ClientActionPreferences,
): "execute" | "confirm" {
  return effectiveApprovalMode(action, preferences) === "dont_ask"
    ? "execute"
    : "confirm";
}

export type AutoPromptBehavior = "execute" | "confirm" | "none";

/**
 * Whether (and how) a proposal may auto-surface without a click. Requires ALL
 * of: the facet configured `auto_prompt`, a validated proposal, and a FRESH
 * assistant completion (never history reloads/refetches). The user's local
 * preference then decides: deny → nothing, always_ask → confirmation dialog,
 * dont_ask → open the prefilled reply form directly. Outlook's own Send
 * button remains the final gate in every path.
 */
export function resolveAutoPromptBehavior(input: {
  presentation: string | undefined;
  proposedAction: OutlookClientAction | undefined;
  isFreshCompletion: boolean;
  preferences: ClientActionPreferences;
}): AutoPromptBehavior {
  if (input.presentation !== "auto_prompt") {
    return "none";
  }
  if (!input.proposedAction || !input.isFreshCompletion) {
    return "none";
  }
  const mode = effectiveApprovalMode(input.proposedAction, input.preferences);
  if (mode === "deny") {
    return "none";
  }
  return mode === "dont_ask" ? "execute" : "confirm";
}

/**
 * Persisted-state options: unknown shapes reset to defaults, unknown modes
 * reject the stored value, actions absent from storage keep their default
 * (so adding a future action never invalidates existing settings).
 */
export const clientActionPreferencesPersistedOptions: PersistedStateOptions<ClientActionPreferences> =
  {
    parse: (value) => {
      if (value === null || typeof value !== "object") {
        return null;
      }
      const candidate = value as Record<string, unknown>;
      const result = { ...DEFAULT_CLIENT_ACTION_PREFERENCES };
      for (const action of IMPLEMENTED_CLIENT_ACTIONS) {
        const mode = candidate[action];
        if (mode === undefined) {
          continue;
        }
        if (!isApprovalMode(mode)) {
          return null;
        }
        result[action] = mode;
      }
      return result;
    },
  };
