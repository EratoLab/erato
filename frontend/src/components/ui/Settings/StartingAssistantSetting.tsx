import { t } from "@lingui/core/macro";
import { useMemo, useState } from "react";

import { DropdownMenu } from "../Controls/DropdownMenu";
import { RadioCard } from "../Controls/RadioCard";
import { ChevronDownIcon } from "../icons";

import type { DropdownMenuItem } from "../Controls/DropdownMenu";

/**
 * The user's tri-state start-screen override:
 * - `"inherit"`: follow an admin's audience pin when one applies.
 * - `"assistant"`: always open one specific assistant.
 * - `"welcome"`: always the welcome screen, even when a pin applies.
 *
 * `"inherit"` and `"welcome"` must stay distinguishable end to end; they save
 * as `preference_starting_assistant_cleared` false and true.
 */
export type StartScreenChoice = "inherit" | "assistant" | "welcome";

/**
 * Which id kind the preference stores for a pick. A hub assistant is stored by
 * its stable `assistant_hub_assistants.id`, because the clone's `assistants.id`
 * is minted fresh on every republish; an assistant that was never published to
 * the hub has no hub row and is stored by `assistants.id`.
 */
export type StartingAssistantKind = "hub" | "assistant";

export interface StartingAssistantPick {
  kind: StartingAssistantKind;
  id: string;
}

export interface StartingAssistantOption extends StartingAssistantPick {
  name: string;
  description?: string | null;
}

interface StartingAssistantSettingProps {
  choice: StartScreenChoice;
  onChoiceChange: (choice: StartScreenChoice) => void;
  selectedPick: StartingAssistantPick | null;
  onSelectPick: (pick: StartingAssistantPick) => void;
  /** Hub assistants the calling user can access. */
  hubOptions: StartingAssistantOption[];
  /** The user's own and directly shared assistants. */
  assistantOptions: StartingAssistantOption[];
  isLoadingOptions: boolean;
}

function samePick(
  left: StartingAssistantPick | null,
  right: StartingAssistantPick,
): boolean {
  return left !== null && left.kind === right.kind && left.id === right.id;
}

/**
 * The start-screen preference control on the Personalization tab. Fully
 * controlled: the dialog owns the state and saves it with the other
 * preference fields.
 */
export function StartingAssistantSetting({
  choice,
  onChoiceChange,
  selectedPick,
  onSelectPick,
  hubOptions,
  assistantOptions,
  isLoadingOptions,
}: StartingAssistantSettingProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const hubSectionHeader = t({
    id: "preferences.dialog.startScreen.picker.section.hub",
    message: "From the assistant hub",
  });
  const ownSectionHeader = t({
    id: "preferences.dialog.startScreen.picker.section.own",
    message: "Your assistants",
  });

  const selectedOption = useMemo(
    () =>
      [...hubOptions, ...assistantOptions].find((option) =>
        samePick(selectedPick, option),
      ) ?? null,
    [assistantOptions, hubOptions, selectedPick],
  );

  const dropdownItems: DropdownMenuItem[] = useMemo(() => {
    // Headers only earn their space when both kinds are on offer; with one
    // list they would label the whole menu.
    const showSectionHeaders =
      hubOptions.length > 0 && assistantOptions.length > 0;

    const toItem = (
      option: StartingAssistantOption,
      sectionHeader?: string,
    ): DropdownMenuItem => ({
      id: `${option.kind}:${option.id}`,
      sectionHeader,
      label: (
        <span className="block min-w-0 max-w-[22rem]">
          <span
            className="block truncate text-sm font-medium text-theme-fg-primary"
            title={option.name}
          >
            {option.name}
          </span>
          {option.description ? (
            <span
              className="block truncate text-xs font-normal text-theme-fg-muted"
              title={option.description}
            >
              {option.description}
            </span>
          ) : null}
        </span>
      ),
      onClick: () => onSelectPick({ kind: option.kind, id: option.id }),
      checked: samePick(selectedPick, option),
    });

    return [
      ...hubOptions.map((option, index) =>
        toItem(
          option,
          showSectionHeaders && index === 0 ? hubSectionHeader : undefined,
        ),
      ),
      ...assistantOptions.map((option, index) =>
        toItem(
          option,
          showSectionHeaders && index === 0 ? ownSectionHeader : undefined,
        ),
      ),
    ];
  }, [
    assistantOptions,
    hubOptions,
    hubSectionHeader,
    onSelectPick,
    ownSectionHeader,
    selectedPick,
  ]);

  const placeholderLabel = t({
    id: "preferences.dialog.startScreen.picker.placeholder",
    message: "Choose an assistant",
  });
  // A stored pick can name an assistant since unpublished, unshared or
  // archived. Keep the id — saving must not silently destroy the pick — but
  // say so.
  const triggerLabel =
    selectedOption?.name ??
    (selectedPick !== null
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
            {isLoadingOptions ? (
              <p className="text-sm text-theme-fg-muted">
                {t({
                  id: "preferences.dialog.startScreen.picker.loading",
                  message: "Loading assistants...",
                })}
              </p>
            ) : dropdownItems.length === 0 && selectedPick === null ? (
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
