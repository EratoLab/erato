import { RadioCard, usePersistedState } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useId } from "react";

import { useActionFacetClientActions } from "../hooks/useAvailableActionFacets";
import { useOffice } from "../providers/OfficeProvider";
import {
  DEFAULT_OUTLOOK_SESSION_PREFERENCES,
  OUTLOOK_SESSION_PREFERENCES_KEY,
  outlookSessionPreferencesPersistedOptions,
  type OutlookSessionPreferences,
} from "../sessionPolicy";
import {
  CLIENT_ACTION_DECISIONS_KEY,
  DEFAULT_CLIENT_ACTION_DECISIONS,
  clientActionDecisionsPersistedOptions,
  decisionKey,
  effectiveDecision,
  type ClientActionDecision,
} from "../utils/clientActionPolicy";
import {
  CLICK_IS_CONSENT_ACTIONS,
  clientActionDisplayLabel,
  offerableClientActions,
  type OutlookClientAction,
} from "../utils/outlookClientActions";

interface BehaviorTabContentProps {
  emptyStateText: string;
}

export function BehaviorTabContent({
  emptyStateText,
}: BehaviorTabContentProps) {
  const { host } = useOffice();
  const isOutlook = host === "Outlook";
  const radioGroupName = useId();

  const [preferences, setPreferences] =
    usePersistedState<OutlookSessionPreferences>(
      OUTLOOK_SESSION_PREFERENCES_KEY,
      DEFAULT_OUTLOOK_SESSION_PREFERENCES,
      outlookSessionPreferencesPersistedOptions,
    );
  const [decisions, setDecisions] = usePersistedState(
    CLIENT_ACTION_DECISIONS_KEY,
    DEFAULT_CLIENT_ACTION_DECISIONS,
    clientActionDecisionsPersistedOptions,
  );
  // The settings rows mirror what the backend actually advertises: one group
  // per facet with client actions, one decision toggle per implemented
  // action. No facets advertised → the whole section is hidden.
  const clientActionFacets = useActionFacetClientActions();

  if (!isOutlook) {
    return (
      <p className="text-sm italic text-theme-fg-muted">{emptyStateText}</p>
    );
  }

  const modeOptions: ReadonlyArray<{
    value: OutlookSessionPreferences["mode"];
    label: string;
    helper: string;
  }> = [
    {
      value: "resume",
      label: t({
        id: "officeAddin.settings.addin.mode.resume.label",
        message: "Resume last chat",
      }),
      helper: t({
        id: "officeAddin.settings.addin.mode.resume.helper",
        message:
          "Reopens the previous conversation when opening or switching emails.",
      }),
    },
    {
      value: "ask",
      label: t({
        id: "officeAddin.settings.addin.mode.ask.label",
        message: "Ask on conversation change",
      }),
      helper: t({
        id: "officeAddin.settings.addin.mode.ask.helper",
        message:
          "When opening a different email, ask to continue previous chat or start a new one.",
      }),
    },
    {
      value: "new",
      label: t({
        id: "officeAddin.settings.addin.mode.new.label",
        message: "Start new chat",
      }),
      helper: t({
        id: "officeAddin.settings.addin.mode.new.helper",
        message:
          "Start a new chat each time when opening or switching to a different conversation.",
      }),
    },
  ];

  // Decision toggles mirror the stored per-facet+action decisions written by
  // the inline permission card. Always the same three options; defaults to
  // "ask" until the user decides otherwise. Click-is-consent actions execute
  // on click regardless of the decision — for them the "ask" copy (and the
  // org lock) must claim only what it governs: assistant-initiated runs.
  const decisionOptionLabels = (
    action: OutlookClientAction,
  ): Record<ClientActionDecision, { label: string; helper: string }> => ({
    ask: CLICK_IS_CONSENT_ACTIONS.has(action)
      ? {
          label: t({
            id: "officeAddin.settings.addin.clientActions.clickConsent.ask.label",
            message: "Ask before running automatically",
          }),
          helper: t({
            id: "officeAddin.settings.addin.clientActions.clickConsent.ask.helper",
            message:
              "Shows a confirmation step only when the assistant triggers this action on its own. Clicking the action's button always runs it directly.",
          }),
        }
      : {
          label: t({
            id: "officeAddin.settings.addin.clientActions.ask.label",
            message: "Ask every time",
          }),
          helper: t({
            id: "officeAddin.settings.addin.clientActions.ask.helper",
            message:
              "Shows a confirmation step in the chat before opening anything.",
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
  const alwaysLockedHelper = (action: OutlookClientAction) =>
    CLICK_IS_CONSENT_ACTIONS.has(action)
      ? t({
          id: "officeAddin.settings.addin.clientActions.clickConsent.always.locked",
          message:
            "Locked: your organization requires confirmation each time this action runs automatically.",
        })
      : t({
          id: "officeAddin.settings.addin.clientActions.always.locked",
          message:
            "Locked: your organization requires confirmation for this action every time.",
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

  const composeToggleLabel = t({
    id: "officeAddin.settings.addin.composeInherits.label",
    message: "Stay same chat on Forward or Reply",
  });
  const composeToggleHelper = t({
    id: "officeAddin.settings.addin.composeInherits.helper",
    message:
      "When replying or forwarding an email, keep the current chat instead of starting a new one.",
  });

  return (
    <div className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-theme-fg-primary">
          {t({
            id: "officeAddin.settings.addin.mode.legend",
            message: "When you switch to a different email",
          })}
        </legend>
        <div className="space-y-2">
          {modeOptions.map((option) => {
            const supportsComposeToggle =
              option.value === "ask" || option.value === "new";
            const composeInputId = `${radioGroupName}-${option.value}-compose-inherits`;

            return (
              <RadioCard
                key={option.value}
                name={radioGroupName}
                value={option.value}
                checked={preferences.mode === option.value}
                onChange={() =>
                  setPreferences({ ...preferences, mode: option.value })
                }
                label={option.label}
                helper={option.helper}
              >
                {supportsComposeToggle ? (
                  <label
                    htmlFor={composeInputId}
                    aria-label={composeToggleLabel}
                    className="flex cursor-pointer items-start gap-3 p-3 pl-10 hover:bg-theme-bg-hover"
                  >
                    <input
                      id={composeInputId}
                      type="checkbox"
                      checked={preferences.composeInheritsFromRead}
                      onChange={(event) =>
                        setPreferences({
                          ...preferences,
                          composeInheritsFromRead: event.target.checked,
                        })
                      }
                      className="mt-1 size-4 cursor-pointer accent-theme-bg-accent"
                    />
                    <span className="flex flex-col gap-1">
                      <span className="text-sm font-medium text-theme-fg-primary">
                        {composeToggleLabel}
                      </span>
                      <span className="text-xs text-theme-fg-secondary">
                        {composeToggleHelper}
                      </span>
                    </span>
                  </label>
                ) : null}
              </RadioCard>
            );
          })}
        </div>
      </fieldset>
      {clientActionGroups.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-theme-fg-primary">
            {t({
              id: "officeAddin.settings.addin.clientActions.legend",
              message: "Assistant-suggested actions",
            })}
          </legend>
          <p className="text-xs text-theme-fg-secondary">
            {t({
              id: "officeAddin.settings.addin.clientActions.intro",
              message:
                "Your decisions from the in-chat confirmation are stored here and can be changed any time. Nothing is sent until you press Send in Outlook.",
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
        </fieldset>
      )}
    </div>
  );
}
