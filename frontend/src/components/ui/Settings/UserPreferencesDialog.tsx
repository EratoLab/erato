import { t } from "@lingui/core/macro";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAudioInputDevicePreference } from "@/hooks/audio/useAudioInputDevicePreference";
import {
  fetchCompleteMcpServerOauth,
  fetchUpdateProfilePreferences,
  profileQuery,
  recentChatsQuery,
  useArchiveAllChatsEndpoint,
  useDisconnectMcpServerOauth,
  useListMcpServers,
  useStartMcpServerOauth,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import {
  useAudioDictationFeature,
  useAudioTranscriptionFeature,
  useUserPreferencesFeature,
} from "@/providers/FeatureConfigProvider";

import { MicTestPanel } from "./MicTestPanel";
import { Button } from "../Controls/Button";
import {
  DropdownMenu,
  type DropdownMenuItem,
} from "../Controls/DropdownMenu";
import { Alert } from "../Feedback/Alert";
import { FormField, Input, Textarea } from "../Input";
import { ModalBase } from "../Modal/ModalBase";
import {
  ChevronDownIcon,
  ErrorIcon,
  LockIcon,
  LinkIcon,
  LinkSlashIcon,
  MediaImageIcon,
  MenuScaleIcon,
  ResolvedIcon,
  CheckCircleIcon,
  VoiceIcon,
  WarningCircleIcon,
} from "../icons";
import { AppearanceTabContent } from "./AppearanceTabContent";

import type {
  McpServerStatus,
  McpServerStatusValue,
  UpdateProfilePreferencesRequest,
  UserProfile,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { KeyboardEvent, ReactNode } from "react";

type PreferencesTab =
  | "personalization"
  | "appearance"
  | "audio"
  | "mcpServers"
  | "data";

interface UserPreferencesDialogProps {
  isOpen: boolean;
  initialTab?: PreferencesTab;
  onMcpOauthCallbackHandled?: () => void;
  onClose: () => void;
  pendingMcpOauthCallback?: {
    code: string;
    serverId: string;
    state: string;
  } | null;
  userProfile?: UserProfile;
}

export function UserPreferencesDialog({
  isOpen,
  initialTab,
  onMcpOauthCallbackHandled,
  onClose,
  pendingMcpOauthCallback,
  userProfile,
}: UserPreferencesDialogProps) {
  const navigate = useNavigate();
  const tabGroupId = useId();
  const queryClient = useQueryClient();
  const { enabled: personalizationEnabled, mcpServersTabEnabled } =
    useUserPreferencesFeature();
  const { enabled: audioTranscriptionEnabled } = useAudioTranscriptionFeature();
  const { enabled: audioDictationEnabled } = useAudioDictationFeature();
  const audioInputSettingsEnabled =
    audioTranscriptionEnabled || audioDictationEnabled;
  const {
    audioInputDeviceError,
    audioInputDevices,
    isLoadingAudioInputDevices,
    refreshAudioInputDevices,
    selectedAudioInputDeviceId,
    setSelectedAudioInputDeviceId,
  } = useAudioInputDevicePreference();
  const [isAudioInputDropdownOpen, setIsAudioInputDropdownOpen] =
    useState(false);
  const audioInputDefaultLabel = t({
    id: "preferences.dialog.audio.input.default",
    message: "System default microphone",
  });
  const audioInputItems = useMemo<DropdownMenuItem[]>(
    () => [
      {
        id: "audio-input-default",
        label: audioInputDefaultLabel,
        checked: selectedAudioInputDeviceId === "",
        onClick: () => setSelectedAudioInputDeviceId(""),
      },
      ...audioInputDevices.map((device) => ({
        id: `audio-input-${device.deviceId}`,
        label: device.label,
        checked: device.deviceId === selectedAudioInputDeviceId,
        onClick: () => setSelectedAudioInputDeviceId(device.deviceId),
      })),
    ],
    [
      audioInputDefaultLabel,
      audioInputDevices,
      selectedAudioInputDeviceId,
      setSelectedAudioInputDeviceId,
    ],
  );
  const selectedAudioInputLabel = useMemo(() => {
    if (!selectedAudioInputDeviceId) {
      return audioInputDefaultLabel;
    }
    return (
      audioInputDevices.find(
        (device) => device.deviceId === selectedAudioInputDeviceId,
      )?.label ?? audioInputDefaultLabel
    );
  }, [audioInputDefaultLabel, audioInputDevices, selectedAudioInputDeviceId]);
  const defaultTab: PreferencesTab = personalizationEnabled
    ? "personalization"
    : "appearance";
  const [activeTab, setActiveTab] = useState<PreferencesTab>(() => defaultTab);
  const [nickname, setNickname] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [additionalInformation, setAdditionalInformation] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpSuccess, setMcpSuccess] = useState<string | null>(null);
  const [authorizingServerId, setAuthorizingServerId] = useState<string | null>(
    null,
  );
  const [disconnectingServerId, setDisconnectingServerId] = useState<
    string | null
  >(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveSuccess, setArchiveSuccess] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const { mutateAsync: archiveAllChatsMutation } = useArchiveAllChatsEndpoint();
  const { mutateAsync: disconnectMcpServerOauthMutation } =
    useDisconnectMcpServerOauth();
  const { mutateAsync: startMcpServerOauthMutation } = useStartMcpServerOauth();
  const {
    data: mcpServersResponse,
    error: mcpServersError,
    isLoading: isMcpServersLoading,
    isRefetching: isMcpServersRefetching,
    refetch: refetchMcpServers,
  } = useListMcpServers(isOpen && activeTab === "mcpServers" ? {} : skipToken, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const visibleTabs = useMemo(
    () =>
      (personalizationEnabled
        ? [
            "personalization",
            "appearance",
            ...(audioInputSettingsEnabled ? (["audio"] as const) : []),
            ...(mcpServersTabEnabled
              ? // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal preferences tab id
                (["mcpServers"] as const)
              : []),
            "data",
          ]
        : [
            "appearance",
            ...(audioInputSettingsEnabled ? (["audio"] as const) : []),
            ...(mcpServersTabEnabled
              ? // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal preferences tab id
                (["mcpServers"] as const)
              : []),
            "data",
          ]) satisfies PreferencesTab[],
    [audioInputSettingsEnabled, mcpServersTabEnabled, personalizationEnabled],
  );
  const handledOauthCallbackKeyRef = useRef<string | null>(null);
  const requestedDefaultTab =
    initialTab && visibleTabs.includes(initialTab) ? initialTab : defaultTab;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveTab(requestedDefaultTab);
    setSaveError(null);
    setMcpError(null);
    setMcpSuccess(null);
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
  }, [isOpen, requestedDefaultTab, userProfile]);

  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab(visibleTabs[0]);
    }
  }, [activeTab, visibleTabs]);

  useEffect(() => {
    if (!isOpen || activeTab !== "mcpServers" || !pendingMcpOauthCallback) {
      return;
    }

    const callbackKey = [
      pendingMcpOauthCallback.serverId,
      pendingMcpOauthCallback.code,
      pendingMcpOauthCallback.state,
    ].join(":");
    if (handledOauthCallbackKeyRef.current === callbackKey) {
      return;
    }
    handledOauthCallbackKeyRef.current = callbackKey;

    const completeOauthCallback = async () => {
      setMcpError(null);
      setMcpSuccess(null);

      try {
        const response = await fetchCompleteMcpServerOauth({
          pathParams: { serverId: pendingMcpOauthCallback.serverId },
          queryParams: {
            code: pendingMcpOauthCallback.code,
            state: pendingMcpOauthCallback.state,
          },
        });
        await refetchMcpServers();

        if (response.connection_status === "SUCCESS") {
          setMcpSuccess(
            t({
              id: "preferences.dialog.mcpServers.oauth.success",
              message: "Authorization complete. The server is ready to use.",
            }),
          );
        } else if (response.connection_status === "NEEDS_AUTHENTICATION") {
          setMcpError(
            t({
              id: "preferences.dialog.mcpServers.oauth.incompleteAfterCallback",
              message:
                "Authorization did not complete successfully. Please try again.",
            }),
          );
        } else {
          setMcpError(
            t({
              id: "preferences.dialog.mcpServers.oauth.failureAfterCallback",
              message:
                "Authorization finished, but the server is still unavailable. Try refreshing its status.",
            }),
          );
        }
      } catch {
        setMcpError(
          t({
            id: "preferences.dialog.mcpServers.oauth.incompleteAfterCallback",
            message:
              "Authorization did not complete successfully. Please try again.",
          }),
        );
      } finally {
        onMcpOauthCallbackHandled?.();
      }
    };

    void completeOauthCallback();
  }, [
    activeTab,
    isOpen,
    onMcpOauthCallbackHandled,
    pendingMcpOauthCallback,
    refetchMcpServers,
  ]);

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
    audio: t({
      id: "preferences.dialog.tabs.audio",
      message: "Audio",
    }),
    mcpServers: t({
      id: "preferences.dialog.tabs.mcpServers",
      message: "MCP servers",
    }),
    data: t({ id: "preferences.dialog.tabs.data", message: "Data" }),
  } satisfies Record<PreferencesTab, string>;

  const tabIcons = {
    personalization: <MenuScaleIcon className="size-4" />,
    appearance: <MediaImageIcon className="size-4" />,
    audio: <VoiceIcon className="size-4" />,
    mcpServers: (
      <ResolvedIcon
        iconId="simpleicons-modelcontextprotocol"
        className="size-4"
      />
    ),
    data: <LockIcon className="size-4" />,
  } satisfies Record<PreferencesTab, ReactNode>;

  /* eslint-disable lingui/no-unlocalized-strings -- Internal DOM ids, not user-facing copy */
  const tabIds = {
    personalization: `${tabGroupId}-tab-personalization`,
    appearance: `${tabGroupId}-tab-appearance`,
    audio: `${tabGroupId}-tab-audio`,
    mcpServers: `${tabGroupId}-tab-mcp-servers`,
    data: `${tabGroupId}-tab-data`,
  } satisfies Record<PreferencesTab, string>;

  const panelIds = {
    personalization: `${tabGroupId}-panel-personalization`,
    appearance: `${tabGroupId}-panel-appearance`,
    audio: `${tabGroupId}-panel-audio`,
    mcpServers: `${tabGroupId}-panel-mcp-servers`,
    data: `${tabGroupId}-panel-data`,
  } satisfies Record<PreferencesTab, string>;
  /* eslint-enable lingui/no-unlocalized-strings */

  const mcpServers = mcpServersResponse?.servers ?? [];

  const focusTab = (tab: PreferencesTab) => {
    const element = document.getElementById(tabIds[tab]);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "nearest", inline: "nearest" });
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

  const handleStartMcpOauth = async (serverId: string) => {
    setMcpError(null);
    setMcpSuccess(null);
    setAuthorizingServerId(serverId);

    try {
      const response = await startMcpServerOauthMutation({
        pathParams: { serverId },
      });
      window.location.href = response.authorization_url;
    } catch {
      setAuthorizingServerId(null);
      setMcpError(
        t({
          id: "preferences.dialog.mcpServers.oauth.startError",
          message: "Could not start authorization. Please try again.",
        }),
      );
    }
  };

  const handleDisconnectMcpOauth = async (serverId: string) => {
    setMcpError(null);
    setMcpSuccess(null);
    setDisconnectingServerId(serverId);

    try {
      await disconnectMcpServerOauthMutation({
        pathParams: { serverId },
      });
      await refetchMcpServers();
      setMcpSuccess(
        t({
          id: "preferences.dialog.mcpServers.oauth.disconnectSuccess",
          message: "Disconnected successfully.",
        }),
      );
    } catch {
      setMcpError(
        t({
          id: "preferences.dialog.mcpServers.oauth.disconnectError",
          message: "Could not disconnect. Please try again.",
        }),
      );
    } finally {
      setDisconnectingServerId(null);
    }
  };

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      title={t({ id: "preferences.dialog.title", message: "Preferences" })}
      contentClassName="h-[80vh] max-h-[700px] max-w-4xl"
    >
      <div className="flex h-full flex-col gap-4 md:flex-row md:gap-5">
        <aside className="shrink-0 border-b border-theme-border pb-3 md:w-48 md:border-b-0 md:border-r md:pb-0 md:pr-4">
          <div
            role="tablist"
            aria-label={t({
              id: "preferences.dialog.title",
              message: "Preferences",
            })}
            aria-orientation="vertical"
            className="flex gap-1 overflow-x-auto md:flex-col md:overflow-x-visible"
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
                    "flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm md:w-full",
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
                className="space-y-4"
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
              className="space-y-4"
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

              <AppearanceTabContent />
            </section>

            {audioInputSettingsEnabled ? (
              <section
                id={panelIds.audio}
                role="tabpanel"
                aria-labelledby={tabIds.audio}
                hidden={activeTab !== "audio"}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <h2 className="text-sm font-medium text-theme-fg-primary">
                    {t({
                      id: "preferences.dialog.audio.input.heading",
                      message: "Microphone",
                    })}
                  </h2>
                  <p className="text-sm text-theme-fg-secondary">
                    {t({
                      id: "preferences.dialog.audio.input.description",
                      message:
                        "Choose the audio input device used for chat recordings on this browser.",
                    })}
                  </p>
                </div>

                {audioInputDeviceError ? (
                  <Alert type="error">{audioInputDeviceError}</Alert>
                ) : null}

                <DropdownMenu
                  id="preferences-audio-input-device"
                  items={audioInputItems}
                  align="left"
                  triggerButtonVariant="secondary"
                  triggerButtonClassName="w-full justify-between gap-2 rounded-[var(--theme-radius-input)] px-3 py-2 shadow-sm"
                  matchContentWidth={false}
                  onOpenChange={setIsAudioInputDropdownOpen}
                  triggerIcon={
                    <div
                      className="flex min-w-0 flex-1 items-center gap-2"
                      data-testid="audio-input-dropdown-trigger"
                    >
                      <span
                        className="min-w-0 flex-1 truncate text-left text-sm text-theme-fg-primary"
                        title={selectedAudioInputLabel}
                      >
                        {selectedAudioInputLabel}
                      </span>
                      <ChevronDownIcon
                        className={clsx(
                          "size-4 shrink-0 text-theme-fg-secondary transition-transform duration-200",
                          isAudioInputDropdownOpen && "rotate-180",
                        )}
                        aria-hidden="true"
                      />
                    </div>
                  }
                />

                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-theme-fg-muted">
                    {audioInputDevices.length === 0
                      ? t({
                          id: "preferences.dialog.audio.input.empty",
                          message:
                            "No microphones were found. Browser permission may be required before device names are available.",
                        })
                      : t({
                          id: "preferences.dialog.audio.input.persisted",
                          message:
                            "This selection is saved locally in this browser.",
                        })}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    disabled={isLoadingAudioInputDevices}
                    onClick={() => {
                      void refreshAudioInputDevices();
                    }}
                  >
                    {isLoadingAudioInputDevices
                      ? t({
                          id: "preferences.dialog.audio.input.refreshing",
                          message: "Refreshing...",
                        })
                      : t({
                          id: "preferences.dialog.audio.input.refresh",
                          message: "Refresh devices",
                        })}
                  </Button>
                </div>

                <div className="space-y-1">
                  <h3 className="text-sm font-medium text-theme-fg-primary">
                    {t({
                      id: "preferences.dialog.audio.test.heading",
                      message: "Test microphone",
                    })}
                  </h3>
                  <p className="text-sm text-theme-fg-secondary">
                    {t({
                      id: "preferences.dialog.audio.test.description",
                      message:
                        "Start the test and speak — the bars should move and the active device label should match your selection.",
                    })}
                  </p>
                </div>
                <MicTestPanel
                  deviceId={selectedAudioInputDeviceId}
                  isAvailable={isOpen && activeTab === "audio"}
                />
              </section>
            ) : null}

            <section
              id={panelIds.mcpServers}
              role="tabpanel"
              aria-labelledby={tabIds.mcpServers}
              hidden={activeTab !== "mcpServers"}
              className="space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-sm font-medium text-theme-fg-primary">
                    {t({
                      id: "preferences.dialog.mcpServers.heading",
                      message: "MCP server connections",
                    })}
                  </h2>
                  <p className="text-sm text-theme-fg-secondary">
                    {t({
                      id: "preferences.dialog.mcpServers.description",
                      message:
                        "Review the MCP servers available to your account and complete any required authorization.",
                    })}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void refetchMcpServers();
                  }}
                  disabled={isMcpServersLoading || isMcpServersRefetching}
                >
                  {isMcpServersRefetching
                    ? t({
                        id: "preferences.dialog.mcpServers.refreshing",
                        message: "Refreshing...",
                      })
                    : t({
                        id: "preferences.dialog.mcpServers.refresh",
                        message: "Refresh status",
                      })}
                </Button>
              </div>

              {mcpSuccess ? <Alert type="success">{mcpSuccess}</Alert> : null}
              {mcpError ? <Alert type="error">{mcpError}</Alert> : null}
              {mcpServersError ? (
                <Alert type="error">
                  {t({
                    id: "preferences.dialog.mcpServers.load.error",
                    message: "Could not load MCP servers. Please try again.",
                  })}
                </Alert>
              ) : null}

              {isMcpServersLoading ? (
                <Alert type="info">
                  {t({
                    id: "preferences.dialog.mcpServers.loading",
                    message: "Loading MCP server status...",
                  })}
                </Alert>
              ) : null}

              {!isMcpServersLoading &&
              !mcpServersError &&
              mcpServers.length === 0 ? (
                <Alert type="info">
                  {t({
                    id: "preferences.dialog.mcpServers.empty",
                    message: "No MCP servers are currently available to you.",
                  })}
                </Alert>
              ) : null}

              {!isMcpServersLoading && !mcpServersError ? (
                <div className="space-y-3">
                  {mcpServers.map((server) => (
                    <McpServerCard
                      key={server.id}
                      server={server}
                      isAuthorizing={authorizingServerId === server.id}
                      isDisconnecting={disconnectingServerId === server.id}
                      onAuthorize={() => {
                        void handleStartMcpOauth(server.id);
                      }}
                      onDisconnect={() => {
                        void handleDisconnectMcpOauth(server.id);
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </section>

            <section
              id={panelIds.data}
              role="tabpanel"
              aria-labelledby={tabIds.data}
              hidden={activeTab !== "data"}
              className="space-y-4"
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

function McpServerCard({
  isAuthorizing,
  isDisconnecting,
  onDisconnect,
  onAuthorize,
  server,
}: {
  isAuthorizing: boolean;
  isDisconnecting: boolean;
  onDisconnect: () => void;
  onAuthorize: () => void;
  server: McpServerStatus;
}) {
  const statusTone = {
    SUCCESS: {
      badgeClass:
        "border-theme-success-border bg-theme-success-bg text-theme-success-fg",
      description: t({
        id: "preferences.dialog.mcpServers.status.success.description",
        message: "Connected and ready to use.",
      }),
      icon: <CheckCircleIcon className="size-4" />,
      label: t({
        id: "preferences.dialog.mcpServers.status.success.label",
        message: "Connected",
      }),
    },
    NEEDS_AUTHENTICATION: {
      badgeClass:
        "border-theme-warning-border bg-theme-warning-bg text-theme-warning-fg",
      description: t({
        id: "preferences.dialog.mcpServers.status.needsAuthentication.description",
        message: "Authorization is required before this server can be used.",
      }),
      icon: <WarningCircleIcon className="size-4" />,
      label: t({
        id: "preferences.dialog.mcpServers.status.needsAuthentication.label",
        message: "Needs authentication",
      }),
    },
    FAILURE: {
      badgeClass:
        "border-theme-error-border bg-theme-error-bg text-theme-error-fg",
      description: t({
        id: "preferences.dialog.mcpServers.status.failure.description",
        message:
          "The server is configured, but the backend could not connect to it.",
      }),
      icon: <ErrorIcon className="size-4" />,
      label: t({
        id: "preferences.dialog.mcpServers.status.failure.label",
        message: "Connection failed",
      }),
    },
  } satisfies Record<
    McpServerStatusValue,
    {
      badgeClass: string;
      description: string;
      icon: ReactNode;
      label: string;
    }
  >;

  const status = statusTone[server.connection_status];

  return (
    <article className="rounded-lg border border-theme-border bg-theme-bg-primary p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <ResolvedIcon
              iconId="simpleicons-modelcontextprotocol"
              className="size-4 text-theme-fg-secondary"
            />
            <h3 className="font-medium text-theme-fg-primary">{server.id}</h3>
            <span
              className={clsx(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                status.badgeClass,
              )}
            >
              <span aria-hidden="true">{status.icon}</span>
              {status.label}
            </span>
          </div>
          <p className="text-sm text-theme-fg-secondary">
            {status.description}
          </p>
          <p className="text-xs uppercase tracking-wide text-theme-fg-muted">
            {t({
              id: "preferences.dialog.mcpServers.authenticationMode",
              message: "Authentication mode",
            })}
            {": "}
            {server.authentication_mode}
          </p>
        </div>

        {server.connection_status === "NEEDS_AUTHENTICATION" ? (
          <Button
            variant="primary"
            size="sm"
            icon={<LinkIcon className="size-4" />}
            disabled={isAuthorizing}
            onClick={onAuthorize}
          >
            {isAuthorizing
              ? t({
                  id: "preferences.dialog.mcpServers.oauth.authorizing",
                  message: "Authorizing...",
                })
              : t({
                  id: "preferences.dialog.mcpServers.oauth.authorize",
                  message: "Authorize",
                })}
          </Button>
        ) : server.authentication_mode === "oauth2" ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<LinkSlashIcon className="size-4" />}
            disabled={isDisconnecting}
            onClick={onDisconnect}
          >
            {isDisconnecting
              ? t({
                  id: "preferences.dialog.mcpServers.oauth.disconnecting",
                  message: "Disconnecting...",
                })
              : t({
                  id: "preferences.dialog.mcpServers.oauth.disconnect",
                  message: "Disconnect",
                })}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
