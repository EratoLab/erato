import {
  AppearanceTabContent,
  AudioInputTabContent,
  ModalBase,
  ServersToolsPane,
  useFeatureConfig,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

import { UserSettingsTabContent } from "./UserSettingsTabContent";

type SettingsTab = "appearance" | "user" | "audio" | "serversTools" | "host";

export interface AddinSettingsHostContribution {
  tabLabel: string;
  heading: string;
  description: string;
  content: ReactNode;
  systemDescription?: string;
  appearanceNotice?: ReactNode;
  /**
   * Host-provided entity rows for the shared "MCP & Apps" pane (e.g. the
   * Outlook-actions entity). Their presence alone enables the pane tab.
   */
  serversToolsEntities?: ReactNode;
}

export interface AddinSettingsDialogCoreProps {
  isOpen: boolean;
  onClose: () => void;
  hostContribution?: AddinSettingsHostContribution;
}

/** Shared settings surface; host tabs and host-specific copy are opt-in. */
export function AddinSettingsDialogCore({
  isOpen,
  onClose,
  hostContribution,
}: AddinSettingsDialogCoreProps) {
  const featureConfig = useFeatureConfig();
  const audioSettingsEnabled =
    featureConfig.audioTranscription.enabled ||
    featureConfig.audioDictation.enabled ||
    featureConfig.audioConversational.enabled;
  const desktopSidecarEnabled =
    featureConfig.userPreferences.desktopSidecarTabEnabled;
  const mcpServersEnabled = featureConfig.userPreferences.mcpServersTabEnabled;
  const serversToolsTabEnabled =
    hostContribution?.serversToolsEntities != null ||
    desktopSidecarEnabled ||
    mcpServersEnabled;
  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");

  const tabOrder = useMemo<SettingsTab[]>(
    () => [
      "appearance",
      "user",
      ...(audioSettingsEnabled ? (["audio"] as const) : []),
      ...(serversToolsTabEnabled ? (["serversTools"] as const) : []),
      ...(hostContribution ? (["host"] as const) : []),
    ],
    [audioSettingsEnabled, serversToolsTabEnabled, hostContribution],
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
    serversTools: t({
      id: "officeAddin.settings.tabs.serversTools",
      message: "MCP & Apps",
    }),
    host: hostContribution?.tabLabel ?? "",
  };

  const tabIds: Record<SettingsTab, string> = {
    appearance: "addin-settings-tab-appearance",
    user: "addin-settings-tab-user",
    audio: "addin-settings-tab-audio",
    serversTools: "addin-settings-tab-servers-tools",
    host: "addin-settings-tab-host",
  };

  const panelIds: Record<SettingsTab, string> = {
    appearance: "addin-settings-panel-appearance",
    user: "addin-settings-panel-user",
    audio: "addin-settings-panel-audio",
    serversTools: "addin-settings-panel-servers-tools",
    host: "addin-settings-panel-host",
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
                hostContribution?.systemDescription ??
                t({
                  id: "officeAddin.settings.appearance.system.description.neutral",
                  message: "Match your host appearance.",
                })
              }
            />
            {hostContribution?.appearanceNotice}
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

          {serversToolsTabEnabled ? (
            <section
              id={panelIds.serversTools}
              role="tabpanel"
              aria-labelledby={tabIds.serversTools}
              hidden={activeTab !== "serversTools"}
              className="h-full space-y-4 overflow-y-auto"
            >
              <div className="space-y-1">
                <h2 className="text-sm font-medium text-theme-fg-primary">
                  {t({
                    id: "officeAddin.settings.serversTools.heading",
                    message: "MCP & Apps",
                  })}
                </h2>
                <p className="text-sm text-theme-fg-secondary">
                  {t({
                    id: "officeAddin.settings.serversTools.description",
                    message:
                      "Everything the assistant can connect to or act through. Open an entry to check its connection or adjust what it may do.",
                  })}
                </p>
              </div>
              {activeTab === "serversTools" ? (
                <ServersToolsPane
                  isActive={isOpen && activeTab === "serversTools"}
                  mcp={
                    mcpServersEnabled
                      ? {
                          // The OAuth round-trip is web-shaped (full-page IdP
                          // redirect; backend mints a web return URL), so the
                          // add-in hands authorization to the browser.
                          onAuthorize: () => {
                            window.open(
                              "/?preferencesDialog=open&preferencesTab=serversTools",
                              "_blank",
                              "noopener",
                            );
                          },
                          onDisconnect: () => {
                            window.open(
                              "/?preferencesDialog=open&preferencesTab=serversTools",
                              "_blank",
                              "noopener",
                            );
                          },
                          showDisconnect: false,
                          authorizeLabel: t({
                            id: "officeAddin.settings.serversTools.authorizeInBrowser",
                            message: "Authorize in browser",
                          }),
                        }
                      : null
                  }
                  showDesktopSidecar={desktopSidecarEnabled}
                >
                  {hostContribution?.serversToolsEntities}
                </ServersToolsPane>
              ) : null}
            </section>
          ) : null}

          {hostContribution ? (
            <section
              id={panelIds.host}
              role="tabpanel"
              aria-labelledby={tabIds.host}
              hidden={activeTab !== "host"}
              className="h-full space-y-4 overflow-y-auto"
            >
              <div className="space-y-1">
                <h2 className="text-sm font-medium text-theme-fg-primary">
                  {hostContribution.heading}
                </h2>
                <p className="text-sm text-theme-fg-secondary">
                  {hostContribution.description}
                </p>
              </div>
              {hostContribution.content}
            </section>
          ) : null}
        </div>
      </div>
    </ModalBase>
  );
}
