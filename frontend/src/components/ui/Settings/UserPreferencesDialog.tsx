import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useId, useMemo, useState } from "react";

import { profileQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { Button } from "../Controls/Button";
import { Alert } from "../Feedback/Alert";
import { FormField, Textarea } from "../Input";
import { ModalBase } from "../Modal/ModalBase";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

type PreferencesTab = "personalization" | "data";

const PREFERENCES_TAB_ORDER: PreferencesTab[] = ["personalization", "data"];

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
  const tabGroupId = useId();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<PreferencesTab>("personalization");
  const [nickname, setNickname] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [additionalInformation, setAdditionalInformation] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveSuccess, setArchiveSuccess] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setActiveTab("personalization");
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
  }, [isOpen, userProfile]);

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
    data: t({ id: "preferences.dialog.tabs.data", message: "Data" }),
  } satisfies Record<PreferencesTab, string>;

  /* eslint-disable lingui/no-unlocalized-strings -- Internal DOM ids, not user-facing copy */
  const tabIds = {
    personalization: `${tabGroupId}-tab-personalization`,
    data: `${tabGroupId}-tab-data`,
  } satisfies Record<PreferencesTab, string>;

  const panelIds = {
    personalization: `${tabGroupId}-panel-personalization`,
    data: `${tabGroupId}-panel-data`,
  } satisfies Record<PreferencesTab, string>;
  /* eslint-enable lingui/no-unlocalized-strings */

  const focusTab = (tab: PreferencesTab) => {
    document.getElementById(tabIds[tab])?.focus();
  };

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentTab: PreferencesTab,
  ) => {
    const currentIndex = PREFERENCES_TAB_ORDER.indexOf(currentTab);
    let nextTab: PreferencesTab | undefined;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        nextTab =
          PREFERENCES_TAB_ORDER[
            (currentIndex + 1) % PREFERENCES_TAB_ORDER.length
          ];
        break;
      case "ArrowUp":
      case "ArrowLeft":
        nextTab =
          PREFERENCES_TAB_ORDER[
            (currentIndex - 1 + PREFERENCES_TAB_ORDER.length) %
              PREFERENCES_TAB_ORDER.length
          ];
        break;
      case "Home":
        nextTab = PREFERENCES_TAB_ORDER[0];
        break;
      case "End":
        nextTab = PREFERENCES_TAB_ORDER[PREFERENCES_TAB_ORDER.length - 1];
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
      // eslint-disable-next-line lingui/no-unlocalized-strings -- API route, not user-facing copy
      const response = await fetch("/api/v1beta/me/profile/preferences", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          preference_nickname: toNullableValue(nickname),
          preference_job_title: toNullableValue(jobTitle),
          preference_assistant_custom_instructions:
            toNullableValue(customInstructions),
          preference_assistant_additional_information: toNullableValue(
            additionalInformation,
          ),
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to update preferences");
      }
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
      // eslint-disable-next-line lingui/no-unlocalized-strings -- API route, not user-facing copy
      const response = await fetch("/api/v1beta/me/chats/archive_all", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        throw new Error("Failed to archive all chats");
      }

      await response.json();
      setArchiveSuccess(
        t({
          id: "preferences.dialog.dataTab.archiveAll.success",
          message: "Archived chats successfully.",
        }),
      );
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
      contentClassName="max-w-4xl h-[80vh] max-h-[700px]"
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
            {PREFERENCES_TAB_ORDER.map((tab) => {
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
                    "w-full cursor-pointer rounded-md px-3 py-2 text-left text-sm",
                    "theme-transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus",
                    isActive
                      ? "bg-theme-bg-hover font-medium text-theme-fg-primary"
                      : "text-theme-fg-secondary hover:bg-theme-bg-hover",
                  )}
                  onClick={() => setActiveTab(tab)}
                  onKeyDown={(event) => handleTabKeyDown(event, tab)}
                >
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
              <>
                <FormField
                  label={t({
                    id: "preferences.dialog.fields.nickname.label",
                    message: "Nickname",
                  })}
                  htmlFor="preferences-nickname"
                >
                  <input
                    id="preferences-nickname"
                    type="text"
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    className="w-full rounded-lg border border-theme-border bg-theme-bg-secondary px-4 py-2.5 text-base text-theme-fg-primary placeholder:text-theme-fg-muted focus:border-theme-border-focus focus:outline-none focus:ring-2 focus:ring-theme-focus"
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
                  <input
                    id="preferences-job-title"
                    type="text"
                    value={jobTitle}
                    onChange={(event) => setJobTitle(event.target.value)}
                    className="w-full rounded-lg border border-theme-border bg-theme-bg-secondary px-4 py-2.5 text-base text-theme-fg-primary placeholder:text-theme-fg-muted focus:border-theme-border-focus focus:outline-none focus:ring-2 focus:ring-theme-focus"
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
              </>
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

          {activeTab === "personalization" ? (
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
