import {
  AppearanceTabContent,
  AudioInputTabContent,
  ModalBase,
  ServersToolsPane,
  TabRail,
  TextSizeSetting,
  useFeatureConfig,
  useMcpBrowserAuthorization,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useId, useMemo, useState, type ReactNode } from "react";

import { UserSettingsTabContent } from "./UserSettingsTabContent";

type SettingsTab = "appearance" | "user" | "audio" | "serversTools" | "host";

export interface AddinSettingsHostContribution {
  /**
   * The host tab's four fields travel together: a host either contributes a
   * tab or it does not. They are optional because a host may contribute ONLY
   * an entity to the shared "MCP & Apps" pane (Word does), and forcing it to
   * declare a heading for a tab it has no content for would spawn an empty
   * tab. The tab is gated on `content`, not on the contribution existing.
   */
  tabLabel?: string;
  heading?: string;
  description?: string;
  content?: ReactNode;
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
  const authorizeInBrowser = useMcpBrowserAuthorization();
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
      ...(hostContribution?.content != null ? (["host"] as const) : []),
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

  const tabGroupId = useId();

  const tabIds: Record<SettingsTab, string> = {
    appearance: `${tabGroupId}-tab-appearance`,
    user: `${tabGroupId}-tab-user`,
    audio: `${tabGroupId}-tab-audio`,
    serversTools: `${tabGroupId}-tab-servers-tools`,
    host: `${tabGroupId}-tab-host`,
  };

  const panelIds: Record<SettingsTab, string> = {
    appearance: `${tabGroupId}-panel-appearance`,
    user: `${tabGroupId}-panel-user`,
    audio: `${tabGroupId}-panel-audio`,
    serversTools: `${tabGroupId}-panel-servers-tools`,
    host: `${tabGroupId}-panel-host`,
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
          <TabRail
            variant="rail"
            orientation="horizontal"
            // The rail is horizontal, but it always took Up/Down as well as
            // Left/Right; keyboard users of the task pane rely on both pairs.
            arrowKeys="both"
            aria-label={dialogTitle}
            data-ui="tab-rail"
            className="overflow-x-auto"
            options={tabOrder.map((tab) => ({
              value: tab,
              label: tabLabels[tab],
              id: tabIds[tab],
              panelId: panelIds[tab],
            }))}
            value={activeTab}
            onChange={setActiveTab}
          />
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
            <TextSizeSetting />
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
                          onAuthorize: authorizeInBrowser,
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

          {hostContribution?.content != null ? (
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
