import { t } from "@lingui/core/macro";
import { useMemo, useState } from "react";

import { DropdownMenu } from "../Controls/DropdownMenu";
import { RadioCard } from "../Controls/RadioCard";
import { ChevronDownIcon } from "../icons";

import type { DropdownMenuItem } from "../Controls/DropdownMenu";
import type { AssistantHubVersion } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * The user's tri-state start-screen override:
 * - `"inherit"`: follow an admin's audience pin when one applies.
 * - `"assistant"`: always open one specific hub assistant.
 * - `"welcome"`: always the welcome screen, even when a pin applies.
 *
 * `"inherit"` and `"welcome"` must stay distinguishable end to end; they save
 * as `preference_starting_assistant_cleared` false and true.
 */
export type StartScreenChoice = "inherit" | "assistant" | "welcome";

interface StartingAssistantSettingProps {
  choice: StartScreenChoice;
  onChoiceChange: (choice: StartScreenChoice) => void;
  /** The pick as an `assistant_hub_assistants.id`. */
  selectedHubAssistantId: string | null;
  onSelectHubAssistant: (hubAssistantId: string) => void;
  /** Published hub assistants the calling user can access. */
  hubVersions: AssistantHubVersion[];
  isLoadingHubVersions: boolean;
}

/**
 * The start-screen preference control on the Personalization tab. Fully
 * controlled: the dialog owns the state and saves it with the other
 * preference fields.
 */
export function StartingAssistantSetting({
  choice,
  onChoiceChange,
  selectedHubAssistantId,
  onSelectHubAssistant,
  hubVersions,
  isLoadingHubVersions,
}: StartingAssistantSettingProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const selectedVersion = useMemo(
    () =>
      hubVersions.find(
        (version) => version.hub_assistant_id === selectedHubAssistantId,
      ) ?? null,
    [hubVersions, selectedHubAssistantId],
  );

  const dropdownItems: DropdownMenuItem[] = useMemo(
    () =>
      hubVersions.map((version) => ({
        label: (
          <span className="block min-w-0 max-w-[22rem]">
            <span
              className="block truncate text-sm font-medium text-theme-fg-primary"
              title={version.assistant.name}
            >
              {version.assistant.name}
            </span>
            {version.assistant.description ? (
              <span
                className="block truncate text-xs font-normal text-theme-fg-muted"
                title={version.assistant.description}
              >
                {version.assistant.description}
              </span>
            ) : null}
          </span>
        ),
        onClick: () => onSelectHubAssistant(version.hub_assistant_id),
        checked: version.hub_assistant_id === selectedHubAssistantId,
      })),
    [hubVersions, onSelectHubAssistant, selectedHubAssistantId],
  );

  const placeholderLabel = t({
    id: "preferences.dialog.startScreen.picker.placeholder",
    message: "Choose an assistant",
  });
  // A stored pick can name an assistant since unpublished or unshared. Keep
  // the id — saving must not silently destroy the pick — but say so.
  const triggerLabel =
    selectedVersion?.assistant.name ??
    (selectedHubAssistantId !== null
      ? t({
          id: "preferences.dialog.startScreen.picker.unavailable",
          message: "An assistant you can no longer access",
        })
      : placeholderLabel);

  return (
    <fieldset>
      <legend className="mb-2 text-base font-semibold text-theme-fg-primary">
        {t({
          id: "preferences.dialog.startScreen.label",
          message: "Start screen",
        })}
      </legend>
      <div className="space-y-2">
        <p className="text-sm text-theme-fg-secondary">
          {t({
            id: "preferences.dialog.startScreen.description",
            message: "Choose where Erato takes you when it opens.",
          })}
        </p>

        <RadioCard
          name="start-screen-choice"
          value="inherit"
          checked={choice === "inherit"}
          onChange={() => onChoiceChange("inherit")}
          label={t({
            id: "preferences.dialog.startScreen.inherit.label",
            message: "Automatic",
          })}
          helper={t({
            id: "preferences.dialog.startScreen.inherit.helper",
            message:
              "Use your organization's default when one is set, otherwise the welcome screen.",
          })}
        />

        <RadioCard
          name="start-screen-choice"
          value="assistant"
          checked={choice === "assistant"}
          onChange={() => onChoiceChange("assistant")}
          label={t({
            id: "preferences.dialog.startScreen.assistant.label",
            message: "A specific assistant",
          })}
          helper={t({
            id: "preferences.dialog.startScreen.assistant.helper",
            message: "Always open a chat with the assistant you choose.",
          })}
        >
          <div className="p-3">
            {isLoadingHubVersions ? (
              <p className="text-sm text-theme-fg-muted">
                {t({
                  id: "preferences.dialog.startScreen.picker.loading",
                  message: "Loading assistants...",
                })}
              </p>
            ) : hubVersions.length === 0 && selectedHubAssistantId === null ? (
              <p className="text-sm text-theme-fg-muted">
                {t({
                  id: "preferences.dialog.startScreen.picker.empty",
                  message: "No assistants are available to choose from yet.",
                })}
              </p>
            ) : (
              <DropdownMenu
                items={dropdownItems}
                align="left"
                onOpenChange={setIsDropdownOpen}
                matchContentWidth
                triggerButtonVariant="secondary"
                triggerButtonClassName="min-w-[12rem] max-w-full justify-between gap-2"
                triggerIcon={
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      className="min-w-0 flex-1 truncate text-left text-sm font-medium text-theme-fg-primary"
                      title={triggerLabel}
                    >
                      {triggerLabel}
                    </span>
                    <ChevronDownIcon
                      className={`size-3 shrink-0 text-theme-fg-secondary transition-transform duration-200 ${
                        isDropdownOpen ? "rotate-180" : ""
                      }`}
                    />
                  </div>
                }
                id="starting-assistant-dropdown"
              />
            )}
          </div>
        </RadioCard>

        <RadioCard
          name="start-screen-choice"
          value="welcome"
          checked={choice === "welcome"}
          onChange={() => onChoiceChange("welcome")}
          label={t({
            id: "preferences.dialog.startScreen.welcome.label",
            message: "Always start on the welcome screen",
          })}
          helper={t({
            id: "preferences.dialog.startScreen.welcome.helper",
            message: "Skip any default your organization has set.",
          })}
        />
      </div>
    </fieldset>
  );
}

// eslint-disable-next-line lingui/no-unlocalized-strings
StartingAssistantSetting.displayName = "StartingAssistantSetting";
