import {
  Alert,
  AppearanceTabContent,
  Button,
  FormField,
  Input,
  ModalBase,
  Textarea,
  fetchUpdateProfilePreferences,
  profileQuery,
  useProfile,
  usePersistedState,
  type UpdateProfilePreferencesRequest,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";

import { useOffice } from "../providers/OfficeProvider";
import {
  DEFAULT_OUTLOOK_SESSION_PREFERENCES,
  OUTLOOK_SESSION_PREFERENCES_KEY,
  outlookSessionPreferencesPersistedOptions,
  type OutlookSessionPreferences,
} from "../sessionPolicy";

type SettingsTab = "appearance" | "user" | "addin";

const TAB_ORDER: readonly SettingsTab[] = [
  "appearance",
  "user",
  "addin",
] as const;

interface AddinSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddinSettingsDialog({
  isOpen,
  onClose,
}: AddinSettingsDialogProps) {
  const { profile } = useProfile();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");
  const [nickname, setNickname] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [additionalInformation, setAdditionalInformation] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab("appearance");
    setSaveError(null);
    setNickname(profile?.preference_nickname ?? "");
    setJobTitle(profile?.preference_job_title ?? "");
    setCustomInstructions(
      profile?.preference_assistant_custom_instructions ?? "",
    );
    setAdditionalInformation(
      profile?.preference_assistant_additional_information ?? "",
    );
  }, [isOpen, profile]);

  const hasChanges = useMemo(
    () =>
      nickname !== (profile?.preference_nickname ?? "") ||
      jobTitle !== (profile?.preference_job_title ?? "") ||
      customInstructions !==
        (profile?.preference_assistant_custom_instructions ?? "") ||
      additionalInformation !==
        (profile?.preference_assistant_additional_information ?? ""),
    [additionalInformation, customInstructions, jobTitle, nickname, profile],
  );

  const toNullableValue = (value: string) => {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  };

  const handleSave = async () => {
    setSaveError(null);
    setIsSaving(true);
    try {
      // The generated schema currently drops the string branch for these optional patch fields.
      const requestBody = {
        preference_nickname: toNullableValue(nickname),
        preference_job_title: toNullableValue(jobTitle),
        preference_assistant_custom_instructions:
          toNullableValue(customInstructions),
        preference_assistant_additional_information: toNullableValue(
          additionalInformation,
        ),
      } as unknown as UpdateProfilePreferencesRequest;

      await fetchUpdateProfilePreferences({ body: requestBody });
      await queryClient.invalidateQueries({
        queryKey: profileQuery({}).queryKey,
      });
      onClose();
    } catch {
      setSaveError(
        t({
          id: "officeAddin.settings.user.save.error",
          message: "Could not save preferences. Please try again.",
        }),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const tabLabels: Record<SettingsTab, string> = {
    appearance: t({
      id: "officeAddin.settings.tabs.appearance",
      message: "Appearance",
    }),
    user: t({
      id: "officeAddin.settings.tabs.user",
      message: "User settings",
    }),
    addin: t({
      id: "officeAddin.settings.tabs.addin",
      message: "Add-in",
    }),
  };

  const tabIds: Record<SettingsTab, string> = {
    appearance: "addin-settings-tab-appearance",
    user: "addin-settings-tab-user",
    addin: "addin-settings-tab-addin",
  };

  const panelIds: Record<SettingsTab, string> = {
    appearance: "addin-settings-panel-appearance",
    user: "addin-settings-panel-user",
    addin: "addin-settings-panel-addin",
  };

  const focusTab = (tab: SettingsTab) => {
    const element = document.getElementById(tabIds[tab]);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentTab: SettingsTab,
  ) => {
    const currentIndex = TAB_ORDER.indexOf(currentTab);
    let nextTab: SettingsTab | undefined;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        nextTab = TAB_ORDER[(currentIndex + 1) % TAB_ORDER.length];
        break;
      case "ArrowUp":
      case "ArrowLeft":
        nextTab =
          TAB_ORDER[(currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length];
        break;
      case "Home":
        nextTab = TAB_ORDER[0];
        break;
      case "End":
        nextTab = TAB_ORDER[TAB_ORDER.length - 1];
        break;
      default:
        return;
    }

    if (!nextTab) return;
    event.preventDefault();
    setActiveTab(nextTab);
    focusTab(nextTab);
  };

  const dialogTitle = t({
    id: "officeAddin.settings.title",
    message: "Settings",
  });

  const emptyStateText = t({
    id: "officeAddin.settings.placeholder.empty",
    message: "No settings available yet.",
  });

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title={dialogTitle}
      contentClassName="h-[80vh] max-h-[600px] max-w-xl"
    >
      <div className="flex h-full flex-col gap-4">
        <div className="shrink-0 border-b border-theme-border pb-2">
          <div
            role="tablist"
            aria-label={dialogTitle}
            aria-orientation="horizontal"
            className="flex gap-1 overflow-x-auto"
          >
            {TAB_ORDER.map((tab) => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  id={tabIds[tab]}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={panelIds[tab]}
                  tabIndex={isActive ? 0 : -1}
                  className={`flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm theme-transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus ${
                    isActive
                      ? "bg-theme-bg-hover font-medium text-theme-fg-primary"
                      : "text-theme-fg-secondary hover:bg-theme-bg-hover"
                  }`}
                  onClick={() => setActiveTab(tab)}
                  onKeyDown={(event) => handleTabKeyDown(event, tab)}
                >
                  {tabLabels[tab]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-1">
          <section
            id={panelIds.appearance}
            role="tabpanel"
            aria-labelledby={tabIds.appearance}
            hidden={activeTab !== "appearance"}
            className="space-y-4"
          >
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-theme-fg-primary">
                {t({
                  id: "officeAddin.settings.appearance.heading",
                  message: "Color mode",
                })}
              </h2>
              <p className="text-sm text-theme-fg-secondary">
                {t({
                  id: "officeAddin.settings.appearance.description",
                  message: "Choose how Erato should look in this add-in.",
                })}
              </p>
            </div>

            <AppearanceTabContent
              systemDescription={t({
                id: "officeAddin.settings.appearance.system.description",
                message: "Match your Office host appearance.",
              })}
            />
          </section>

          <section
            id={panelIds.user}
            role="tabpanel"
            aria-labelledby={tabIds.user}
            hidden={activeTab !== "user"}
            className="space-y-4"
          >
            {saveError ? <Alert type="error">{saveError}</Alert> : null}

            <FormField
              label={t({
                id: "officeAddin.settings.user.nickname.label",
                message: "Nickname",
              })}
              htmlFor="addin-settings-nickname"
            >
              <Input
                id="addin-settings-nickname"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder={t({
                  id: "officeAddin.settings.user.nickname.placeholder",
                  message:
                    "What should the assistant call you? e.g. Max Mustermann",
                })}
              />
            </FormField>

            <FormField
              label={t({
                id: "officeAddin.settings.user.jobTitle.label",
                message: "Job title",
              })}
              htmlFor="addin-settings-job-title"
            >
              <Input
                id="addin-settings-job-title"
                value={jobTitle}
                onChange={(event) => setJobTitle(event.target.value)}
                placeholder={t({
                  id: "officeAddin.settings.user.jobTitle.placeholder",
                  message: "What is your role? e.g. Product Manager",
                })}
              />
            </FormField>

            <FormField
              label={t({
                id: "officeAddin.settings.user.customInstructions.label",
                message: "Custom instructions for the assistant",
              })}
              htmlFor="addin-settings-custom-instructions"
            >
              <Textarea
                id="addin-settings-custom-instructions"
                value={customInstructions}
                onChange={(event) => setCustomInstructions(event.target.value)}
                rows={4}
                autoResize={true}
                placeholder={t({
                  id: "officeAddin.settings.user.customInstructions.placeholder",
                  message:
                    "How should the assistant behave? e.g. Prefer concise bullet points",
                })}
              />
            </FormField>

            <FormField
              label={t({
                id: "officeAddin.settings.user.additionalInformation.label",
                message: "Additional information",
              })}
              htmlFor="addin-settings-additional-information"
            >
              <Textarea
                id="addin-settings-additional-information"
                value={additionalInformation}
                onChange={(event) =>
                  setAdditionalInformation(event.target.value)
                }
                rows={4}
                autoResize={true}
                placeholder={t({
                  id: "officeAddin.settings.user.additionalInformation.placeholder",
                  message:
                    "Any extra context for the assistant, e.g. I work with enterprise customers",
                })}
              />
            </FormField>
          </section>

          <section
            id={panelIds.addin}
            role="tabpanel"
            aria-labelledby={tabIds.addin}
            hidden={activeTab !== "addin"}
            className="space-y-4"
          >
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-theme-fg-primary">
                {t({
                  id: "officeAddin.settings.addin.heading",
                  message: "Add-in behavior",
                })}
              </h2>
              <p className="text-sm text-theme-fg-secondary">
                {t({
                  id: "officeAddin.settings.addin.description",
                  message:
                    "Configure how the add-in behaves inside Office, such as how switching between emails maps to chats.",
                })}
              </p>
            </div>
            <AddinBehaviorPanel emptyStateText={emptyStateText} />
          </section>
        </div>

        {activeTab === "user" ? (
          <div className="mt-2 flex shrink-0 justify-end gap-2 border-t border-theme-border pt-3">
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={isSaving}
              type="button"
            >
              {t({
                id: "officeAddin.settings.user.actions.cancel",
                message: "Cancel",
              })}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                void handleSave();
              }}
              disabled={isSaving || !hasChanges}
              type="button"
            >
              {isSaving
                ? t({
                    id: "officeAddin.settings.user.actions.saving",
                    message: "Saving...",
                  })
                : t({
                    id: "officeAddin.settings.user.actions.save",
                    message: "Save",
                  })}
            </Button>
          </div>
        ) : null}
      </div>
    </ModalBase>
  );
}

interface AddinBehaviorPanelProps {
  emptyStateText: string;
}

function AddinBehaviorPanel({ emptyStateText }: AddinBehaviorPanelProps) {
  const { host } = useOffice();
  const isOutlook = host === "Outlook";
  const radioGroupId = useId();

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
            const inputId = `${radioGroupId}-${option.value}`;
            const composeInputId = `${inputId}-compose-inherits`;
            const isChecked = preferences.mode === option.value;
            const showComposeToggle =
              isChecked && (option.value === "ask" || option.value === "new");
            return (
              <div
                key={option.value}
                className="rounded-md border border-theme-border"
              >
                <label
                  htmlFor={inputId}
                  aria-label={option.label}
                  className="flex cursor-pointer items-start gap-3 p-3 hover:bg-theme-bg-hover"
                >
                  <input
                    id={inputId}
                    type="radio"
                    name={radioGroupId}
                    value={option.value}
                    checked={isChecked}
                    onChange={() =>
                      setPreferences({ ...preferences, mode: option.value })
                    }
                    className="mt-1 size-4 cursor-pointer accent-theme-bg-accent"
                  />
                  <span className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-theme-fg-primary">
                      {option.label}
                    </span>
                    <span className="text-xs text-theme-fg-secondary">
                      {option.helper}
                    </span>
                  </span>
                </label>
                {showComposeToggle ? (
                  <label
                    htmlFor={composeInputId}
                    aria-label={t({
                      id: "officeAddin.settings.addin.composeInherits.label",
                      message: "Stay same chat on Forward or Reply",
                    })}
                    className="flex cursor-pointer items-start gap-3 border-t border-theme-border p-3 pl-10 hover:bg-theme-bg-hover"
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
                        {t({
                          id: "officeAddin.settings.addin.composeInherits.label",
                          message: "Stay same chat on Forward or Reply",
                        })}
                      </span>
                      <span className="text-xs text-theme-fg-secondary">
                        {t({
                          id: "officeAddin.settings.addin.composeInherits.helper",
                          message:
                            "When replying or forwarding an email, keep the current chat instead of starting a new one.",
                        })}
                      </span>
                    </span>
                  </label>
                ) : null}
              </div>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
