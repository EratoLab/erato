import {
  AppearanceTabContent,
  AudioInputTabContent,
  ModalBase,
  useFeatureConfig,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useMemo, useState, type KeyboardEvent } from "react";

import { BehaviorTabContent } from "./BehaviorTabContent";
import { UserSettingsTabContent } from "./UserSettingsTabContent";
import { useOffice } from "../providers/OfficeProvider";

type SettingsTab = "appearance" | "user" | "audio" | "addin";

interface AddinSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddinSettingsDialog({
  isOpen,
  onClose,
}: AddinSettingsDialogProps) {
  const { host } = useOffice();
  const isOutlookHost = host === "Outlook";
  const featureConfig = useFeatureConfig();
  // Mirror the chat input: the microphone tab is only relevant when a capture
  // feature (transcription / dictation / conversational) is enabled, so it
  // appears exactly when the audio buttons do.
  const audioSettingsEnabled =
    featureConfig.audioTranscription.enabled ||
    featureConfig.audioDictation.enabled ||
    featureConfig.audioConversational.enabled;
  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");

  const tabOrder = useMemo<SettingsTab[]>(
    () => [
      "appearance",
      "user",
      ...(audioSettingsEnabled ? (["audio"] as const) : []),
      "addin",
    ],
    [audioSettingsEnabled],
  );

  const tabLabels: Record<SettingsTab, string> = {
    appearance: t({
      id: "officeAddin.settings.tabs.appearance",
      message: "Appearance",
    }),
    user: t({
      id: "officeAddin.settings.tabs.user",
      message: "User settings",
    }),
    audio: t({
      id: "officeAddin.settings.tabs.audio",
      message: "Microphone",
    }),
    addin: t({
      id: "officeAddin.settings.tabs.addin",
      message: "Add-in",
    }),
  };

  const tabIds: Record<SettingsTab, string> = {
    appearance: "addin-settings-tab-appearance",
    user: "addin-settings-tab-user",
    audio: "addin-settings-tab-audio",
    addin: "addin-settings-tab-addin",
  };

  const panelIds: Record<SettingsTab, string> = {
    appearance: "addin-settings-panel-appearance",
    user: "addin-settings-panel-user",
    audio: "addin-settings-panel-audio",
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
    const currentIndex = tabOrder.indexOf(currentTab);
    let nextTab: SettingsTab | undefined;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        nextTab = tabOrder[(currentIndex + 1) % tabOrder.length];
        break;
      case "ArrowUp":
      case "ArrowLeft":
        nextTab =
          tabOrder[(currentIndex - 1 + tabOrder.length) % tabOrder.length];
        break;
      case "Home":
        nextTab = tabOrder[0];
        break;
      case "End":
        nextTab = tabOrder[tabOrder.length - 1];
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
            {tabOrder.map((tab) => {
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
                  className={`flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-[var(--theme-radius-control)] px-3 py-2 text-sm theme-transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus ${
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

        <div className="min-h-0 flex-1 px-1">
          <section
            id={panelIds.appearance}
            role="tabpanel"
            aria-labelledby={tabIds.appearance}
            hidden={activeTab !== "appearance"}
            className="h-full space-y-4 overflow-y-auto"
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
              systemDescription={
                isOutlookHost
                  ? t({
                      id: "officeAddin.settings.appearance.system.description.outlook",
                      message: "Follow your Outlook theme.",
                    })
                  : t({
                      id: "officeAddin.settings.appearance.system.description",
                      message: "Match your Office host appearance.",
                    })
              }
            />
            {isOutlookHost ? (
              <p className="text-xs text-theme-fg-muted">
                {t({
                  id: "officeAddin.settings.appearance.outlook.staleness.note",
                  message:
                    "Outlook for Windows requires a full restart to pick up theme changes (known Office bug). Pick Light or Dark above to override the host theme.",
                })}
              </p>
            ) : null}
          </section>

          <section
            id={panelIds.user}
            role="tabpanel"
            aria-labelledby={tabIds.user}
            hidden={activeTab !== "user"}
            className="h-full"
          >
            <UserSettingsTabContent onClose={onClose} />
          </section>

          {audioSettingsEnabled ? (
            <section
              id={panelIds.audio}
              role="tabpanel"
              aria-labelledby={tabIds.audio}
              hidden={activeTab !== "audio"}
              className="h-full space-y-4 overflow-y-auto"
            >
              <div className="space-y-1">
                <h2 className="text-sm font-medium text-theme-fg-primary">
                  {t({
                    id: "officeAddin.settings.audio.heading",
                    message: "Microphone",
                  })}
                </h2>
                <p className="text-sm text-theme-fg-secondary">
                  {t({
                    id: "officeAddin.settings.audio.description",
                    message:
                      "Choose and test the microphone used for voice input in this add-in.",
                  })}
                </p>
              </div>
              <AudioInputTabContent
                isActive={isOpen && activeTab === "audio"}
              />
            </section>
          ) : null}

          <section
            id={panelIds.addin}
            role="tabpanel"
            aria-labelledby={tabIds.addin}
            hidden={activeTab !== "addin"}
            className="h-full space-y-4 overflow-y-auto"
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
            <BehaviorTabContent emptyStateText={emptyStateText} />
          </section>
        </div>
      </div>
    </ModalBase>
  );
}
