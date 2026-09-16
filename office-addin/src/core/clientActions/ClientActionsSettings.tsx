import { RadioCard } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useId } from "react";

import {
  decisionKey,
  effectiveDecision,
  type ClientActionDecision,
  type ClientActionDecisionStore,
} from "./clientActionPolicy";
import { useActionFacetClientActions } from "./useAvailableActionFacets";
import { useClientActionDecisions } from "./useClientActionDecisions";

export interface ClientActionsSettingsProps<TAction extends string> {
  /** The host's decision store (module-level singleton). */
  store: ClientActionDecisionStore;
  /**
   * The host registry's intersection of a facet's server-allowed actions
   * with what this host implements, in the host's fixed display order.
   */
  offerableActions: (allowedActions: readonly string[]) => TAction[];
  /** Human-readable label for an action, shared with the confirm card. */
  displayLabel: (action: TAction) => string;
  /**
   * Host-flavoured copy: the intro states where the decisions come from and
   * what the host's final gate is; the "always allow" helper names that gate
   * too. Everything else on the rows is host-neutral and lives here.
   */
  copy: {
    intro: string;
    alwaysAllowHelper: string;
  };
}

/**
 * Per-action decision rows for assistant-suggested host actions, rendered as
 * the host's actions entity in the Servers & Tools pane. Decisions are
 * device-local (persisted state), unlike the account-wide MCP grants; the
 * scope copy states that.
 */
export function ClientActionsSettings<TAction extends string>({
  store,
  offerableActions,
  displayLabel,
  copy,
}: ClientActionsSettingsProps<TAction>) {
  const radioGroupName = useId();
  const [decisions, setDecisions] = useClientActionDecisions(store);
  // The rows mirror what the backend actually advertises: one group per
  // facet with client actions, one decision toggle per implemented action.
  const clientActionFacets = useActionFacetClientActions();

  // Decision toggles mirror the stored per-facet+action decisions written by
  // the inline permission card. Always the same three options; defaults to
  // "ask" until the user decides otherwise. Decisions govern only
  // assistant-initiated runs — a click on an action's button always executes
  // (universal click-is-consent rule) — so the copy claims exactly that.
  const decisionOptionLabels: Record<
    ClientActionDecision,
    { label: string; helper: string }
  > = {
    ask: {
      label: t({
        id: "officeAddin.settings.addin.clientActions.clickConsent.ask.label",
        message: "Ask before running automatically",
      }),
      helper: t({
        id: "officeAddin.settings.addin.clientActions.clickConsent.ask.helper",
        message:
          "Shows a confirmation step only when the assistant triggers this action on its own. Clicking the action's button always runs it directly.",
      }),
    },
    always: {
      label: t({
        id: "officeAddin.settings.addin.clientActions.always.label",
        message: "Always allow",
      }),
      helper: copy.alwaysAllowHelper,
    },
    never: {
      label: t({
        id: "officeAddin.settings.addin.clientActions.never.label",
        message: "Never",
      }),
      helper: t({
        id: "officeAddin.settings.addin.clientActions.never.helper",
        message: "Hides this action and ignores the assistant's suggestion.",
      }),
    },
  };
  const alwaysLockedHelper = t({
    id: "officeAddin.settings.addin.clientActions.clickConsent.always.locked",
    message:
      "Locked: your organization requires confirmation each time this action runs automatically.",
  });
  const decisionOrder: readonly ClientActionDecision[] = [
    "ask",
    "always",
    "never",
  ];

  const clientActionGroups = [...clientActionFacets.entries()].flatMap(
    ([facetId, info]) => {
      const actions = offerableActions(info.clientActions);
      return actions.length > 0
        ? [{ facetId, displayName: info.displayName, actions, info }]
        : [];
    },
  );

  if (clientActionGroups.length === 0) {
    return (
      <p className="text-sm italic text-theme-fg-muted">
        {t({
          id: "officeAddin.settings.addin.clientActions.empty",
          message: "No assistant-suggested actions are available right now.",
        })}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-theme-fg-secondary">
        {copy.intro}{" "}
        {t({
          id: "officeAddin.settings.addin.clientActions.scope",
          message: "These decisions are stored on this device only.",
        })}
      </p>
      {clientActionGroups.map((group) => (
        <div key={group.facetId} className="space-y-3">
          <p className="text-xs font-medium text-theme-fg-primary">
            {group.displayName}
          </p>
          {group.actions.map((action) => {
            const enforced = group.info.alwaysAskActions.includes(action);
            const current = effectiveDecision({
              facetId: group.facetId,
              action,
              decisions,
              enforcedAskActions: group.info.alwaysAskActions,
            });
            return (
              <div
                key={action}
                role="radiogroup"
                aria-label={displayLabel(action)}
                className="space-y-2"
              >
                <p className="text-xs text-theme-fg-secondary">
                  {displayLabel(action)}
                </p>
                {decisionOrder.map((decision) => {
                  const lockedAlways = decision === "always" && enforced;
                  return (
                    <RadioCard
                      key={decision}
                      size="sm"
                      name={`${radioGroupName}-${group.facetId}-${action}`}
                      value={decision}
                      checked={current === decision}
                      disabled={lockedAlways}
                      onChange={() => {
                        if (lockedAlways) {
                          return;
                        }
                        setDecisions({
                          ...decisions,
                          [decisionKey(group.facetId, action)]: decision,
                        });
                      }}
                      label={decisionOptionLabels[decision].label}
                      helper={
                        lockedAlways
                          ? alwaysLockedHelper
                          : decisionOptionLabels[decision].helper
                      }
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
