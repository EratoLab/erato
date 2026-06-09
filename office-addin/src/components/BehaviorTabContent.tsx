import { RadioCard, usePersistedState } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useId } from "react";

import { useOffice } from "../providers/OfficeProvider";
import {
  DEFAULT_OUTLOOK_SESSION_PREFERENCES,
  OUTLOOK_SESSION_PREFERENCES_KEY,
  outlookSessionPreferencesPersistedOptions,
  type OutlookSessionPreferences,
} from "../sessionPolicy";
import {
  CLIENT_ACTION_PREFERENCES_KEY,
  DEFAULT_CLIENT_ACTION_PREFERENCES,
  clientActionPreferencesPersistedOptions,
  type ClientActionApprovalMode,
  type ClientActionPreferences,
} from "../utils/clientActionPolicy";
import { type OutlookClientAction } from "../utils/outlookClientActions";

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
  const [actionPreferences, setActionPreferences] =
    usePersistedState<ClientActionPreferences>(
      CLIENT_ACTION_PREFERENCES_KEY,
      DEFAULT_CLIENT_ACTION_PREFERENCES,
      clientActionPreferencesPersistedOptions,
    );

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

  // Per-action approval settings for assistant-proposed reply actions.
  // Reply-all deliberately has no "don't ask": its confirmation doubles as
  // the fresh-recipient check and local settings cannot downgrade it.
  const approvalOptionLabels: Record<
    ClientActionApprovalMode,
    { label: string; helper: string }
  > = {
    dont_ask: {
      label: t({
        id: "officeAddin.settings.addin.replyActions.dontAsk.label",
        message: "Open immediately",
      }),
      helper: t({
        id: "officeAddin.settings.addin.replyActions.dontAsk.helper",
        message:
          "Opens the prefilled Outlook reply window without asking. Nothing is sent until you press Send.",
      }),
    },
    always_ask: {
      label: t({
        id: "officeAddin.settings.addin.replyActions.alwaysAsk.label",
        message: "Ask first",
      }),
      helper: t({
        id: "officeAddin.settings.addin.replyActions.alwaysAsk.helper",
        message: "Shows a confirmation before opening the reply window.",
      }),
    },
    deny: {
      label: t({
        id: "officeAddin.settings.addin.replyActions.deny.label",
        message: "Never",
      }),
      helper: t({
        id: "officeAddin.settings.addin.replyActions.deny.helper",
        message: "Hides this action and ignores the assistant's suggestion.",
      }),
    },
  };

  const actionGroups: ReadonlyArray<{
    action: OutlookClientAction;
    legend: string;
    modes: readonly ClientActionApprovalMode[];
  }> = [
    {
      action: "outlook.reply",
      legend: t({
        id: "officeAddin.settings.addin.replyActions.reply.legend",
        message: "Reply to sender",
      }),
      modes: ["dont_ask", "always_ask", "deny"],
    },
    {
      action: "outlook.reply_all",
      legend: t({
        id: "officeAddin.settings.addin.replyActions.replyAll.legend",
        message: "Reply to all recipients",
      }),
      modes: ["always_ask", "deny"],
    },
  ];

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
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-theme-fg-primary">
          {t({
            id: "officeAddin.settings.addin.replyActions.legend",
            message: "When the assistant suggests replying to an email",
          })}
        </legend>
        <p className="text-xs text-theme-fg-secondary">
          {t({
            id: "officeAddin.settings.addin.replyActions.intro",
            message:
              "Applies to reading mode. Replies only open as a prefilled Outlook draft — sending always stays your manual step.",
          })}
        </p>
        {actionGroups.map((group) => (
          <div key={group.action} className="space-y-2">
            <p className="text-xs font-medium text-theme-fg-primary">
              {group.legend}
            </p>
            {group.modes.map((mode) => (
              <RadioCard
                key={mode}
                size="sm"
                name={`${radioGroupName}-${group.action}`}
                value={mode}
                checked={actionPreferences[group.action] === mode}
                onChange={() =>
                  setActionPreferences({
                    ...actionPreferences,
                    [group.action]: mode,
                  })
                }
                label={approvalOptionLabels[mode].label}
                helper={approvalOptionLabels[mode].helper}
              />
            ))}
          </div>
        ))}
      </fieldset>
    </div>
  );
}
