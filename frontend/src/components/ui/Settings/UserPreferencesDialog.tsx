import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useTheme, type ThemeMode } from "@/components/providers/ThemeProvider";
import {
  fetchUpdateProfilePreferences,
  profileQuery,
  recentChatsQuery,
  useArchiveAllChatsEndpoint,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useUserPreferencesFeature } from "@/providers/FeatureConfigProvider";

import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";
import { FormField, Input, Textarea } from "../Input";
import { ModalBase } from "../Modal/ModalBase";
import {
  ComputerIcon,
  LockIcon,
  MediaImageIcon,
  MenuScaleIcon,
  MoonIcon,
  SunIcon,
} from "../icons";

import type {
  UpdateProfilePreferencesRequest,
  UserProfile,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { KeyboardEvent, ReactNode } from "react";

type PreferencesTab = "personalization" | "appearance" | "data";

interface AppearanceOption {
  description: string;
  icon: ReactNode;
  label: string;
  value: ThemeMode;
}

interface UserPreferencesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile?: UserProfile;
}

export function UserPreferencesDialog({
  isOpen,
  onClose,
  userProfile,
}: UserPreferencesDialogProps) {
  const navigate = useNavigate();
  const tabGroupId = useId();
  const queryClient = useQueryClient();
  const { enabled: personalizationEnabled } = useUserPreferencesFeature();
  const { effectiveTheme, setThemeMode, themeMode } = useTheme();
  const [activeTab, setActiveTab] = useState<PreferencesTab>("appearance");
  const [nickname, setNickname] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [additionalInformation, setAdditionalInformation] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveSuccess, setArchiveSuccess] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const { mutateAsync: archiveAllChatsMutation } = useArchiveAllChatsEndpoint();

  const visibleTabs = useMemo(
    () =>
      (personalizationEnabled
        ? ["personalization", "appearance", "data"]
        : ["appearance", "data"]) satisfies PreferencesTab[],
    [personalizationEnabled],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveTab(visibleTabs[0]);
    setSaveError(null);
    setArchiveError(null);
    setArchiveSuccess(null);
    setNickname(userProfile?.preference_nickname ?? "");
    setJobTitle(userProfile?.preference_job_title ?? "");
    setCustomInstructions(
      userProfile?.preference_assistant_custom_instructions ?? "",
    );
    setAdditionalInformation(
      userProfile?.preference_assistant_additional_information ?? "",
    );
  }, [isOpen, userProfile, visibleTabs]);

  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab(visibleTabs[0]);
    }
  }, [activeTab, visibleTabs]);

  const hasChanges = useMemo(
    () =>
      nickname !== (userProfile?.preference_nickname ?? "") ||
      jobTitle !== (userProfile?.preference_job_title ?? "") ||
      customInstructions !==
        (userProfile?.preference_assistant_custom_instructions ?? "") ||
      additionalInformation !==
        (userProfile?.preference_assistant_additional_information ?? ""),
    [
      additionalInformation,
      customInstructions,
      jobTitle,
      nickname,
      userProfile,
    ],
  );

  const toNullableValue = (value: string) => {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  };

  const tabLabels = {
    personalization: t({
      id: "preferences.dialog.tabs.personalization",
      message: "Personalization",
    }),
    appearance: t({
      id: "preferences.dialog.tabs.appearance",
      message: "Appearance",
    }),
    data: t({ id: "preferences.dialog.tabs.data", message: "Data" }),
  } satisfies Record<PreferencesTab, string>;

  const tabIcons = {
    personalization: <MenuScaleIcon className="size-4" />,
    appearance: <MediaImageIcon className="size-4" />,
    data: <LockIcon className="size-4" />,
  } satisfies Record<PreferencesTab, ReactNode>;

  const appearanceOptions = [
    {
      value: "light",
      label: t({
        id: "preferences.dialog.appearance.theme.light.label",
        message: "Light mode",
      }),
      description: t({
        id: "preferences.dialog.appearance.theme.light.description",
        message: "Always use the light theme.",
      }),
      icon: <SunIcon className="size-5" />,
    },
    {
      value: "dark",
      label: t({
        id: "preferences.dialog.appearance.theme.dark.label",
        message: "Dark mode",
      }),
      description: t({
        id: "preferences.dialog.appearance.theme.dark.description",
        message: "Always use the dark theme.",
      }),
      icon: <MoonIcon className="size-5" />,
    },
    {
      value: "system",
      label: t({
        id: "preferences.dialog.appearance.theme.system.label",
        message: "System theme",
      }),
      description: t({
        id: "preferences.dialog.appearance.theme.system.description",
        message: "Match your device appearance settings.",
      }),
      icon: <ComputerIcon className="size-5" />,
    },
  ] satisfies AppearanceOption[];

  /* eslint-disable lingui/no-unlocalized-strings -- Internal DOM ids, not user-facing copy */
  const tabIds = {
    personalization: `${tabGroupId}-tab-personalization`,
    appearance: `${tabGroupId}-tab-appearance`,
    data: `${tabGroupId}-tab-data`,
  } satisfies Record<PreferencesTab, string>;

  const panelIds = {
    personalization: `${tabGroupId}-panel-personalization`,
    appearance: `${tabGroupId}-panel-appearance`,
    data: `${tabGroupId}-panel-data`,
  } satisfies Record<PreferencesTab, string>;
  /* eslint-enable lingui/no-unlocalized-strings */

  const focusTab = (tab: PreferencesTab) => {
    document.getElementById(tabIds[tab])?.focus();
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentTab: PreferencesTab,
  ) => {
    const currentIndex = visibleTabs.indexOf(currentTab);
    let nextTab: PreferencesTab | undefined;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        nextTab = visibleTabs[(currentIndex + 1) % visibleTabs.length];
        break;
      case "ArrowUp":
      case "ArrowLeft":
        nextTab =
          visibleTabs[
            (currentIndex - 1 + visibleTabs.length) % visibleTabs.length
          ];
        break;
      case "Home":
        nextTab = visibleTabs[0];
        break;
      case "End":
        nextTab = visibleTabs[visibleTabs.length - 1];
        break;
      default:
        return;
    }

    event.preventDefault();
    setActiveTab(nextTab);
    focusTab(nextTab);
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

      await fetchUpdateProfilePreferences({
        body: requestBody,
      });
      await queryClient.invalidateQueries({
        queryKey: profileQuery({}).queryKey,
      });
      onClose();
    } catch {
      setSaveError(
        t({
          id: "preferences.dialog.save.error",
          message: "Could not save preferences. Please try again.",
        }),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchiveAllChats = async () => {
    setArchiveError(null);
    setArchiveSuccess(null);
    setIsArchiving(true);
    try {
      const recentChatsQueryKey = recentChatsQuery({}).queryKey;

      await archiveAllChatsMutation({});
      await queryClient.invalidateQueries({ queryKey: recentChatsQueryKey });
      await queryClient.refetchQueries({
        queryKey: recentChatsQueryKey,
        type: "active",
      });

      onClose();
      navigate("/chat/new", { replace: true });
    } catch {
      setArchiveError(
        t({
          id: "preferences.dialog.dataTab.archiveAll.error",
          message: "Could not archive chats. Please try again.",
        }),
      );
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title={t({ id: "preferences.dialog.title", message: "Preferences" })}
      contentClassName="h-[80vh] max-h-[700px] max-w-4xl"
    >
      <div className="flex h-full gap-5">
        <aside className="w-48 shrink-0 border-r border-theme-border pr-4">
          <div
            role="tablist"
            aria-label={t({
              id: "preferences.dialog.title",
              message: "Preferences",
            })}
            aria-orientation="vertical"
            className="space-y-1"
          >
            {visibleTabs.map((tab) => {
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
                  className={clsx(
                    "flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-sm",
                    "theme-transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus",
                    isActive
                      ? "bg-theme-bg-hover font-medium text-theme-fg-primary"
                      : "text-theme-fg-secondary hover:bg-theme-bg-hover",
                  )}
                  onClick={() => setActiveTab(tab)}
                  onKeyDown={(event) => handleTabKeyDown(event, tab)}
                >
                  <span aria-hidden="true" className="shrink-0">
                    {tabIcons[tab]}
                  </span>
                  {tabLabels[tab]}
                </button>
              );
            })}
          </div>
        </aside>

        <section
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          data-testid="user-preferences-dialog"
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
            {saveError ? <Alert type="error">{saveError}</Alert> : null}

            {personalizationEnabled ? (
              <section
                id={panelIds.personalization}
                role="tabpanel"
                aria-labelledby={tabIds.personalization}
                hidden={activeTab !== "personalization"}
                className={clsx(
                  "space-y-4",
                  activeTab !== "personalization" && "hidden",
                )}
              >
                <FormField
                  label={t({
                    id: "preferences.dialog.fields.nickname.label",
                    message: "Nickname",
                  })}
                  htmlFor="preferences-nickname"
                >
                  <Input
                    id="preferences-nickname"
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    placeholder={t({
                      id: "preferences.dialog.fields.nickname.placeholder",
                      message:
                        "What should the assistant call you? e.g. Max Mustermann",
                    })}
                  />
                </FormField>

                <FormField
                  label={t({
                    id: "preferences.dialog.fields.jobTitle.label",
                    message: "Job title",
                  })}
                  htmlFor="preferences-job-title"
                >
                  <Input
                    id="preferences-job-title"
                    value={jobTitle}
                    onChange={(event) => setJobTitle(event.target.value)}
                    placeholder={t({
                      id: "preferences.dialog.fields.jobTitle.placeholder",
                      message: "What is your role? e.g. Product Manager",
                    })}
                  />
                </FormField>

                <FormField
                  label={t({
                    id: "preferences.dialog.fields.customInstructions.label",
                    message: "Custom instructions for the assistant",
                  })}
                  htmlFor="preferences-custom-instructions"
                >
                  <Textarea
                    id="preferences-custom-instructions"
                    value={customInstructions}
                    onChange={(event) =>
                      setCustomInstructions(event.target.value)
                    }
                    rows={4}
                    autoResize={true}
                    placeholder={t({
                      id: "preferences.dialog.fields.customInstructions.placeholder",
                      message:
                        "How should the assistant behave? e.g. Prefer concise bullet points",
                    })}
                  />
                </FormField>

                <FormField
                  label={t({
                    id: "preferences.dialog.fields.additionalInformation.label",
                    message: "Additional information",
                  })}
                  htmlFor="preferences-additional-information"
                >
                  <Textarea
                    id="preferences-additional-information"
                    value={additionalInformation}
                    onChange={(event) =>
                      setAdditionalInformation(event.target.value)
                    }
                    rows={4}
                    autoResize={true}
                    placeholder={t({
                      id: "preferences.dialog.fields.additionalInformation.placeholder",
                      message:
                        "Any extra context for the assistant, e.g. I work with enterprise customers",
                    })}
                  />
                </FormField>
              </section>
            ) : null}

            <section
              id={panelIds.appearance}
              role="tabpanel"
              aria-labelledby={tabIds.appearance}
              hidden={activeTab !== "appearance"}
              className={clsx(
                "space-y-4",
                activeTab !== "appearance" && "hidden",
              )}
            >
              <div className="space-y-1">
                <h2 className="text-sm font-medium text-theme-fg-primary">
                  {t({
                    id: "preferences.dialog.appearance.theme.heading",
                    message: "Color mode",
                  })}
                </h2>
                <p className="text-sm text-theme-fg-secondary">
                  {t({
                    id: "preferences.dialog.appearance.theme.description",
                    message: "Choose how Erato should look for your account.",
                  })}
                </p>
              </div>

              <div
                role="radiogroup"
                aria-label={t({
                  id: "preferences.dialog.appearance.theme.heading",
                  message: "Color mode",
                })}
                className="grid gap-3"
              >
                {appearanceOptions.map((option) => {
                  const isSelected = themeMode === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      className={clsx(
                        "flex items-start gap-3 rounded-lg border p-4 text-left",
                        "theme-transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus",
                        isSelected
                          ? "border-theme-border-focus bg-theme-bg-hover text-theme-fg-primary"
                          : "border-theme-border bg-theme-bg-primary text-theme-fg-secondary hover:bg-theme-bg-hover",
                      )}
                      onClick={() => setThemeMode(option.value)}
                    >
                      <span
                        aria-hidden="true"
                        className={clsx(
                          "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border",
                          isSelected
                            ? "border-theme-border-focus bg-theme-bg-secondary text-theme-fg-primary"
                            : "border-theme-border bg-theme-bg-secondary text-theme-fg-secondary",
                        )}
                      >
                        {option.icon}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <span className="font-medium">{option.label}</span>
                          {option.value === "system" && isSelected ? (
                            <span className="text-xs text-theme-fg-muted">
                              {effectiveTheme === "dark"
                                ? t({
                                    id: "preferences.dialog.appearance.theme.current.dark",
                                    message: "Currently dark",
                                  })
                                : t({
                                    id: "preferences.dialog.appearance.theme.current.light",
                                    message: "Currently light",
                                  })}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block text-sm text-theme-fg-muted">
                          {option.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section
              id={panelIds.data}
              role="tabpanel"
              aria-labelledby={tabIds.data}
              hidden={activeTab !== "data"}
              className={clsx("space-y-4", activeTab !== "data" && "hidden")}
            >
              {archiveSuccess ? (
                <Alert type="success">{archiveSuccess}</Alert>
              ) : null}
              {archiveError ? <Alert type="error">{archiveError}</Alert> : null}
              <Alert type="info">
                {t({
                  id: "preferences.dialog.dataTab.archiveAll.help",
                  message: "Archive all chats in your account.",
                })}
              </Alert>
              <div className="flex justify-end">
                <Button
                  variant="danger"
                  disabled={isArchiving}
                  onClick={() => {
                    void handleArchiveAllChats();
                  }}
                  confirmAction={true}
                  confirmTitle={t({
                    id: "preferences.dialog.dataTab.archiveAll.confirmTitle",
                    message: "Archive all chats?",
                  })}
                  confirmMessage={t({
                    id: "preferences.dialog.dataTab.archiveAll.confirmMessage",
                    message:
                      "This will archive every non-archived chat in your account.",
                  })}
                >
                  {isArchiving
                    ? t({
                        id: "preferences.dialog.dataTab.archiveAll.archiving",
                        message: "Archiving...",
                      })
                    : t({
                        id: "preferences.dialog.dataTab.archiveAll.button",
                        message: "Archive all chats",
                      })}
                </Button>
              </div>
            </section>
          </div>

          {personalizationEnabled && activeTab === "personalization" ? (
            <div className="mt-3 flex justify-end gap-2 border-t border-theme-border pt-3">
              <Button
                variant="secondary"
                onClick={onClose}
                disabled={isSaving}
                type="button"
              >
                {t({
                  id: "preferences.dialog.actions.cancel",
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
                      id: "preferences.dialog.actions.saving",
                      message: "Saving...",
                    })
                  : t({
                      id: "preferences.dialog.actions.save",
                      message: "Save",
                    })}
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </ModalBase>
  );
}

// eslint-disable-next-line lingui/no-unlocalized-strings
UserPreferencesDialog.displayName = "UserPreferencesDialog";
