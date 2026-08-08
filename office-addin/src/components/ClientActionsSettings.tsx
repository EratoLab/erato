import { RadioCard, usePersistedState } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useId } from "react";

import { useActionFacetClientActions } from "../hooks/useAvailableActionFacets";
import {
  CLIENT_ACTION_DECISIONS_KEY,
  DEFAULT_CLIENT_ACTION_DECISIONS,
  clientActionDecisionsPersistedOptions,
  decisionKey,
  effectiveDecision,
  type ClientActionDecision,
} from "../utils/clientActionPolicy";
import {
  clientActionDisplayLabel,
  offerableClientActions,
  type OutlookClientAction,
} from "../utils/outlookClientActions";

/**
 * Per-action decision rows for assistant-suggested Outlook actions, rendered
 * as the "Outlook actions" entity's details in the Servers & Tools pane.
 * Decisions are device-local (persisted state), unlike the account-wide MCP
 * grants; the intro copy states that scope.
 */
export function ClientActionsSettings() {
  const radioGroupName = useId();
  const [decisions, setDecisions] = usePersistedState(
    CLIENT_ACTION_DECISIONS_KEY,
    DEFAULT_CLIENT_ACTION_DECISIONS,
    clientActionDecisionsPersistedOptions,
  );
  // The rows mirror what the backend actually advertises: one group per
  // facet with client actions, one decision toggle per implemented action.
  const clientActionFacets = useActionFacetClientActions();

  // Decision toggles mirror the stored per-facet+action decisions written by
  // the inline permission card. Always the same three options; defaults to
  // "ask" until the user decides otherwise. Decisions govern only
  // assistant-initiated runs — a click on an action's button always executes
  // (universal click-is-consent rule) — so the copy claims exactly that.
  const decisionOptionLabels = (
    _action: OutlookClientAction,
  ): Record<ClientActionDecision, { label: string; helper: string }> => ({
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
      helper: t({
        id: "officeAddin.settings.addin.clientActions.always.helper",
        message:
          "Performs the action without asking. Nothing is sent until you press Send in Outlook.",
      }),
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
  });
  const alwaysLockedHelper = (_action: OutlookClientAction) =>
    t({
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
      const actions = offerableClientActions(info.clientActions);
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
        {t({
          id: "officeAddin.settings.addin.clientActions.intro",
          message:
            "Your decisions from the in-chat confirmation are stored here and can be changed any time. Nothing is sent until you press Send in Outlook.",
        })}{" "}
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
            const optionLabels = decisionOptionLabels(action);
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
                aria-label={clientActionDisplayLabel(action)}
                className="space-y-2"
              >
                <p className="text-xs text-theme-fg-secondary">
                  {clientActionDisplayLabel(action)}
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
                      label={optionLabels[decision].label}
                      helper={
                        lockedAlways
                          ? alwaysLockedHelper(action)
                          : optionLabels[decision].helper
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
