import {
  AppearanceTabContent,
  AudioInputTabContent,
  DisclaimersPane,
  ModalBase,
  ServersToolsPane,
  SettingsPageList,
  TabRail,
  TextSizeSetting,
  isDisclaimersSettingsLink,
  settingsClosedLocation,
  useFeatureConfig,
  useMcpBrowserAuthorization,
  useSettingsPages,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";
import { useId, useMemo, useState, type ReactNode } from "react";
import { useInRouterContext, useLocation, useNavigate } from "react-router-dom";

import { UserSettingsTabContent } from "./UserSettingsTabContent";

export type AddinSettingsTab =
  | "appearance"
  | "user"
  | "audio"
  | "serversTools"
  | "host"
  | "disclaimers";

export interface AddinSettingsHostContribution {
  /** Tool-only contributions need no host tab; content controls tab visibility. */
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
  audioInputSupported?: boolean;
  supportsDisclaimers?: boolean;
  /** Tab to select when opening the dialog. */
  openTab?: AddinSettingsTab;
}

/** Shared settings surface; host tabs and host-specific copy are opt-in. */
export function AddinSettingsDialogCore(props: AddinSettingsDialogCoreProps) {
  const inRouter = useInRouterContext();
  return props.supportsDisclaimers && inRouter ? (
    <RoutedAddinSettingsDialog {...props} />
  ) : (
    <AddinSettingsDialog {...props} />
  );
}

function RoutedAddinSettingsDialog(props: AddinSettingsDialogCoreProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const linkOpen = isDisclaimersSettingsLink(
    new URLSearchParams(location.search),
  );

  return (
    <AddinSettingsDialog
      {...props}
      isOpen={props.isOpen || linkOpen}
      openTab={linkOpen ? "disclaimers" : props.openTab}
      onClose={() => {
        props.onClose();
        if (linkOpen) {
          navigate(settingsClosedLocation(location), { replace: true });
        }
      }}
    />
  );
}

function AddinSettingsDialog({
  isOpen,
  onClose,
  hostContribution,
  audioInputSupported = true,
  supportsDisclaimers = false,
  openTab,
}: AddinSettingsDialogCoreProps) {
  const featureConfig = useFeatureConfig();
  const authorizeInBrowser = useMcpBrowserAuthorization();
  const audioSettingsEnabled =
    !audioInputSupported ||
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
  const disclaimersEnabled =
    supportsDisclaimers && featureConfig.userPreferences.disclaimersTabEnabled;

  const tabOrder = useMemo<AddinSettingsTab[]>(
    () => [
      "appearance",
      "user",
      ...(audioSettingsEnabled ? (["audio"] as const) : []),
      ...(serversToolsTabEnabled ? (["serversTools"] as const) : []),
      ...(hostContribution?.content != null ? (["host"] as const) : []),
      ...(disclaimersEnabled ? (["disclaimers"] as const) : []),
    ],
    [
      audioSettingsEnabled,
      serversToolsTabEnabled,
      hostContribution,
      disclaimersEnabled,
    ],
  );

  const requestedTab =
    isOpen && openTab
      ? tabOrder.includes(openTab)
        ? openTab
        : "appearance"
      : undefined;
  const [lastRequestedTab, setLastRequestedTab] = useState(requestedTab);
  const [selectedTab, setActiveTab] = useState<AddinSettingsTab>(
    requestedTab ?? "appearance",
  );
  if (requestedTab !== lastRequestedTab) {
    setLastRequestedTab(requestedTab);
    if (requestedTab) setActiveTab(requestedTab);
  }
  const activeTab = tabOrder.includes(selectedTab) ? selectedTab : "appearance";

  const tabLabels: Record<AddinSettingsTab, string> = {
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
    disclaimers: t({
      id: "officeAddin.settings.tabs.disclaimers",
      message: "Disclaimers",
    }),
  };

  const pages = useSettingsPages({
    isOpen,
    tabs: tabOrder.map((tab) => ({ value: tab, label: tabLabels[tab] })),
    activeTab,
    onActiveTabChange: setActiveTab,
    requestedTab,
    title: t({ id: "officeAddin.settings.title", message: "Settings" }),
    backLabel: t({
      id: "officeAddin.settings.backToList",
      message: "Back to Settings",
    }),
  });
  const { shownTab } = pages;

  const tabGroupId = useId();

  const tabIds: Record<AddinSettingsTab, string> = {
    appearance: `${tabGroupId}-tab-appearance`,
    user: `${tabGroupId}-tab-user`,
    audio: `${tabGroupId}-tab-audio`,
    serversTools: `${tabGroupId}-tab-servers-tools`,
    host: `${tabGroupId}-tab-host`,
    disclaimers: `${tabGroupId}-tab-disclaimers`,
  };

  const panelIds: Record<AddinSettingsTab, string> = {
    appearance: `${tabGroupId}-panel-appearance`,
    user: `${tabGroupId}-panel-user`,
    audio: `${tabGroupId}-panel-audio`,
    serversTools: `${tabGroupId}-panel-servers-tools`,
    host: `${tabGroupId}-panel-host`,
    disclaimers: `${tabGroupId}-panel-disclaimers`,
  };

  const dialogTitle = t({
    id: "officeAddin.settings.title",
    message: "Settings",
  });

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      {...pages.modalProps}
      contentClassName={
        pages.isNarrow ? undefined : "h-[80vh] max-h-[600px] max-w-xl"
      }
    >
      <div className="flex h-full flex-col gap-4">
        {pages.showList ? <SettingsPageList {...pages.listProps} /> : null}
        {pages.isNarrow ? null : (
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
        )}

        <div className={pages.showList ? "hidden" : "min-h-0 flex-1 px-1"}>
          <section
            {...pages.panelProps("appearance", {
              tabId: tabIds.appearance,
              panelId: panelIds.appearance,
            })}
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
            {...pages.panelProps("user", {
              tabId: tabIds.user,
              panelId: panelIds.user,
            })}
            className="h-full"
          >
            <UserSettingsTabContent onClose={onClose} />
          </section>

          {audioSettingsEnabled ? (
            <section
              {...pages.panelProps("audio", {
                tabId: tabIds.audio,
                panelId: panelIds.audio,
              })}
              className="h-full space-y-4 overflow-y-auto"
            >
              <div className="space-y-1">
                {/* On a narrow pane the page title already says it. */}
                {pages.isNarrow ? null : (
                  <h2 className="text-sm font-medium text-theme-fg-primary">
                    {t({
                      id: "officeAddin.settings.audio.heading",
                      message: "Microphone",
                    })}
                  </h2>
                )}
                <p className="text-sm text-theme-fg-secondary">
                  {t({
                    id: "officeAddin.settings.audio.description",
                    message:
                      "Choose and test the microphone used for voice input in this add-in.",
                  })}
                </p>
              </div>
              {audioInputSupported ? (
                <AudioInputTabContent
                  isActive={isOpen && shownTab === "audio"}
                />
              ) : (
                <p role="status" className="text-sm text-theme-fg-secondary">
                  {t({
                    id: "officeAddin.settings.audio.unsupported",
                    message: "Audio input is not supported on this platform",
                  })}
                </p>
              )}
            </section>
          ) : null}

          {serversToolsTabEnabled ? (
            <section
              {...pages.panelProps("serversTools", {
                tabId: tabIds.serversTools,
                panelId: panelIds.serversTools,
              })}
              className="h-full space-y-4 overflow-y-auto"
            >
              <div className="space-y-1">
                {/* On a narrow pane the page title already says it. */}
                {pages.isNarrow ? null : (
                  <h2 className="text-sm font-medium text-theme-fg-primary">
                    {t({
                      id: "officeAddin.settings.serversTools.heading",
                      message: "MCP & Apps",
                    })}
                  </h2>
                )}
                <p className="text-sm text-theme-fg-secondary">
                  {t({
                    id: "officeAddin.settings.serversTools.description",
                    message:
                      "Everything the assistant can connect to or act through. Open an entry to check its connection or adjust what it may do.",
                  })}
                </p>
              </div>
              {shownTab === "serversTools" ? (
                <ServersToolsPane
                  isActive={isOpen && shownTab === "serversTools"}
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
              {...pages.panelProps("host", {
                tabId: tabIds.host,
                panelId: panelIds.host,
              })}
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
          {disclaimersEnabled ? (
            <section
              {...pages.panelProps("disclaimers", {
                tabId: tabIds.disclaimers,
                panelId: panelIds.disclaimers,
              })}
              // A tab panel on a wide pane (its role comes from panelProps);
              // either way the long text has to be reachable by keyboard.
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
              tabIndex={0}
              className="h-full overflow-y-auto"
            >
              {isOpen && shownTab === "disclaimers" ? (
                <DisclaimersPane />
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </ModalBase>
  );
}
