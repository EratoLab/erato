import {
  RadioCard,
  usePersistedState,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useId } from "react";

import { useOffice } from "../providers/OfficeProvider";
import {
  DEFAULT_OUTLOOK_SESSION_PREFERENCES,
  OUTLOOK_SESSION_PREFERENCES_KEY,
  outlookSessionPreferencesPersistedOptions,
  type OutlookSessionPreferences,
} from "../sessionPolicy";

interface BehaviorTabContentProps {
  emptyStateText: string;
}

export function BehaviorTabContent({ emptyStateText }: BehaviorTabContentProps) {
  const { host } = useOffice();
  const isOutlook = host === "Outlook";
  const radioGroupName = useId();

  const [preferences, setPreferences] =
    usePersistedState<OutlookSessionPreferences>(
      OUTLOOK_SESSION_PREFERENCES_KEY,
      DEFAULT_OUTLOOK_SESSION_PREFERENCES,
      outlookSessionPreferencesPersistedOptions,
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
    </div>
  );
}
