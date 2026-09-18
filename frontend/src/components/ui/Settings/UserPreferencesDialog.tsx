import { t } from "@lingui/core/macro";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  chatDetailQuery,
  fetchUpdateProfilePreferences,
  listMcpServerToolsQuery,
  profileQuery,
  recentChatsQuery,
  startingAssistantQuery,
  useArchiveAllChatsEndpoint,
  useAssistantHubConfig,
  useDisconnectMcpServerOauth,
  useListAssistantHubAssistants,
  useListAssistants,
  useListMcpServers,
  useAvailableModels,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import {
  clearMcpAuthorization,
  startMcpAuthorization,
} from "@/lib/mcpAuthorization";
import {
  useAssistantsFeature,
  useAudioDictationFeature,
  useAudioTranscriptionFeature,
  useUserPreferencesFeature,
} from "@/providers/FeatureConfigProvider";

import { ServersToolsPane } from "./ServersToolsPane";
import {
  StartingAssistantSetting,
  type StartingAssistantOption,
  type StartingAssistantPick,
  type StartScreenChoice,
} from "./StartingAssistantSetting";
import { ModelSelector } from "../Chat/ModelSelector";
import { Button } from "../Controls/Button";
import { TabRail } from "../Controls/TabRail";
import { Alert } from "../Feedback/Alert";
import { FormField, Input, Textarea } from "../Input";
import { ModalBase } from "../Modal/ModalBase";
import { toast } from "../Toast";
import {
  LockIcon,
  MediaImageIcon,
  MenuScaleIcon,
  ResolvedIcon,
  VoiceIcon,
} from "../icons";
import { AppearanceTabContent } from "./AppearanceTabContent";
import { AudioInputTabContent } from "./AudioInputTabContent";
import { TextSizeSetting } from "./TextSizeSetting";
import { mcpAuthorizationToastKey } from "./mcpAuthorizationToasts";

import type {
  ChatModel,
  UpdateProfilePreferencesRequest,
  UserProfile,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

type PreferencesTab =
  | "personalization"
  | "appearance"
  | "audio"
  | "serversTools"
  | "data";

interface UserPreferencesDialogProps {
  isOpen: boolean;
  initialTab?: PreferencesTab;
  onClose: () => void;
  selectedMcpServerId?: string;
  userProfile?: UserProfile;
}

export function UserPreferencesDialog({
  isOpen,
  initialTab,
  onClose,
  selectedMcpServerId,
  userProfile,
}: UserPreferencesDialogProps) {
  const navigate = useNavigate();
  const tabGroupId = useId();
  const queryClient = useQueryClient();
  const {
    enabled: personalizationEnabled,
    dataTabEnabled,
    desktopSidecarTabEnabled,
    mcpServersTabEnabled,
  } = useUserPreferencesFeature();
  const { enabled: audioTranscriptionEnabled } = useAudioTranscriptionFeature();
  const { enabled: audioDictationEnabled } = useAudioDictationFeature();
  const audioInputSettingsEnabled =
    audioTranscriptionEnabled || audioDictationEnabled;
  const defaultTab: PreferencesTab = personalizationEnabled
    ? "personalization"
    : "appearance";
  const [activeTab, setActiveTab] = useState<PreferencesTab>(() => defaultTab);
  const [nickname, setNickname] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [additionalInformation, setAdditionalInformation] = useState("");
  const [defaultModel, setDefaultModel] = useState<ChatModel | null>(null);
  // The choice and the pick are separate state, so toggling away from
  // "assistant" and back does not lose an already-picked assistant.
  const [startScreenChoice, setStartScreenChoice] =
    useState<StartScreenChoice>("inherit");
  const [startingAssistantPick, setStartingAssistantPick] =
    useState<StartingAssistantPick | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [disconnectingServerId, setDisconnectingServerId] = useState<
    string | null
  >(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveSuccess, setArchiveSuccess] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const { mutateAsync: archiveAllChatsMutation } = useArchiveAllChatsEndpoint();
  const { mutateAsync: disconnectMcpServerOauthMutation } =
    useDisconnectMcpServerOauth();
  const { data: availableModelsResponse } = useAvailableModels(
    isOpen ? {} : skipToken,
  );
  const availableModels = useMemo(
    () =>
      Array.isArray(availableModelsResponse) ? availableModelsResponse : [],
    [availableModelsResponse],
  );
  // The start-screen setting needs somewhere to send people: an audience pin
  // or a hub pick needs the hub, a pick of one's own assistant needs only
  // assistants. Either is enough for the setting to be worth showing.
  const { enabled: assistantsEnabled } = useAssistantsFeature();
  const { data: assistantHubConfig } = useAssistantHubConfig(
    isOpen && personalizationEnabled ? {} : skipToken,
  );
  const assistantHubEnabled = assistantHubConfig?.enabled === true;
  const startScreenSettingEnabled = assistantsEnabled || assistantHubEnabled;
  // The only listing that carries the stable `hub_assistant_id` a hub pick
  // stores.
  const { data: hubAssistantsResponse, isLoading: isLoadingHubAssistants } =
    useListAssistantHubAssistants(
      isOpen && assistantHubEnabled ? {} : skipToken,
    );
  const { data: assistantsResponse, isLoading: isLoadingAssistants } =
    useListAssistants(
      isOpen && personalizationEnabled && assistantsEnabled
        ? { queryParams: { sharing_relation: "all" } }
        : skipToken,
    );
  const hubOptions: StartingAssistantOption[] = useMemo(
    () =>
      (hubAssistantsResponse?.versions ?? []).map((version) => ({
        kind: "hub",
        id: version.hub_assistant_id,
        name: version.assistant.name,
        description: version.assistant.description,
      })),
    [hubAssistantsResponse?.versions],
  );
  const assistantOptions: StartingAssistantOption[] = useMemo(() => {
    // A published hub assistant reaches its audience as a share grant on the
    // clone, so it is in this listing too. Offering it twice would also offer
    // the id that a republish strands, so the hub entry wins.
    const hubClonedAssistantIds = new Set(
      (hubAssistantsResponse?.versions ?? []).map(
        (version) => version.assistant_id,
      ),
    );
    return (assistantsResponse ?? [])
      .filter((assistant) => !hubClonedAssistantIds.has(assistant.id))
      .map((assistant) => ({
        kind: "assistant",
        id: assistant.id,
        name: assistant.name,
        description: assistant.description,
      }));
  }, [assistantsResponse, hubAssistantsResponse?.versions]);
  // The pane owns rendering the server list; this instance shares its query
  // key and exists so the OAuth callback/disconnect flows can refetch.
  const { refetch: refetchMcpServers } = useListMcpServers(
    isOpen && activeTab === "serversTools" && mcpServersTabEnabled
      ? {}
      : skipToken,
    {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 0,
    },
  );

  const visibleTabs = useMemo(
    () =>
      (personalizationEnabled
        ? [
            "personalization",
            "appearance",
            ...(audioInputSettingsEnabled ? (["audio"] as const) : []),
            ...(desktopSidecarTabEnabled || mcpServersTabEnabled
              ? // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal preferences tab id
                (["serversTools"] as const)
              : []),
            ...(dataTabEnabled ? (["data"] as const) : []),
          ]
        : [
            "appearance",
            ...(audioInputSettingsEnabled ? (["audio"] as const) : []),
            ...(desktopSidecarTabEnabled || mcpServersTabEnabled
              ? // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal preferences tab id
                (["serversTools"] as const)
              : []),
            ...(dataTabEnabled ? (["data"] as const) : []),
          ]) satisfies PreferencesTab[],
    [
      audioInputSettingsEnabled,
      dataTabEnabled,
      desktopSidecarTabEnabled,
      mcpServersTabEnabled,
      personalizationEnabled,
    ],
  );
  const requestedDefaultTab =
    initialTab && visibleTabs.includes(initialTab) ? initialTab : defaultTab;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setActiveTab(requestedDefaultTab);
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
    setDefaultModel(null);
    // Cleared beats pick beats inherit; a stored row is never more than one of
    // these, and never carries both pick kinds.
    const storedPick: StartingAssistantPick | null =
      userProfile?.preference_starting_hub_assistant_id
        ? { kind: "hub", id: userProfile.preference_starting_hub_assistant_id }
        : userProfile?.preference_starting_assistant_id
          ? {
              kind: "assistant",
              id: userProfile.preference_starting_assistant_id,
            }
          : null;
    setStartScreenChoice(
      userProfile?.preference_starting_assistant_cleared
        ? "welcome"
        : storedPick
          ? "assistant"
          : "inherit",
    );
    setStartingAssistantPick(storedPick);
  }, [isOpen, requestedDefaultTab, userProfile]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setDefaultModel(
      availableModels.find(
        (model) =>
          model.chat_provider_id ===
          userProfile?.preference_default_chat_provider,
      ) ?? null,
    );
  }, [availableModels, isOpen, userProfile?.preference_default_chat_provider]);

  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab(visibleTabs[0]);
    }
  }, [activeTab, visibleTabs]);

  // What the UI resolves to on save. The two id fields are alternatives, and
  // both go on the wire so the save states which kind was chosen.
  const resolvedPick =
    startScreenChoice === "assistant" ? startingAssistantPick : null;
  const resolvedStartingHubAssistantId =
    resolvedPick?.kind === "hub" ? resolvedPick.id : null;
  const resolvedStartingAssistantId =
    resolvedPick?.kind === "assistant" ? resolvedPick.id : null;
  const resolvedStartingAssistantCleared = startScreenChoice === "welcome";
  // "A specific assistant" with nothing chosen is not a state to save: it
  // resolves to the same wire values as "Automatic", so saving it would
  // silently undo a stored clear.
  const startScreenIsIncomplete =
    startScreenChoice === "assistant" && startingAssistantPick === null;

  const hasChanges = useMemo(
    () =>
      nickname !== (userProfile?.preference_nickname ?? "") ||
      jobTitle !== (userProfile?.preference_job_title ?? "") ||
      customInstructions !==
        (userProfile?.preference_assistant_custom_instructions ?? "") ||
      additionalInformation !==
        (userProfile?.preference_assistant_additional_information ?? "") ||
      defaultModel?.chat_provider_id !==
        (userProfile?.preference_default_chat_provider ?? null) ||
      resolvedStartingHubAssistantId !==
        (userProfile?.preference_starting_hub_assistant_id ?? null) ||
      resolvedStartingAssistantId !==
        (userProfile?.preference_starting_assistant_id ?? null) ||
      resolvedStartingAssistantCleared !==
        (userProfile?.preference_starting_assistant_cleared ?? false),
    [
      additionalInformation,
      defaultModel,
      customInstructions,
      jobTitle,
      nickname,
      resolvedStartingAssistantCleared,
      resolvedStartingAssistantId,
      resolvedStartingHubAssistantId,
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
    serversTools: t({
      id: "preferences.dialog.tabs.serversTools",
      message: "MCP & Apps",
    }),
    data: t({ id: "preferences.dialog.tabs.data", message: "Data" }),
  } satisfies Record<PreferencesTab, string>;

  const tabIcons = {
    personalization: <MenuScaleIcon className="size-4" />,
    appearance: <MediaImageIcon className="size-4" />,
    audio: <VoiceIcon className="size-4" />,
    serversTools: <ResolvedIcon iconId="tools" className="size-4" />,
    data: <LockIcon className="size-4" />,
  } satisfies Record<PreferencesTab, ReactNode>;

  /* eslint-disable lingui/no-unlocalized-strings -- Internal DOM ids, not user-facing copy */
  const tabIds = {
    personalization: `${tabGroupId}-tab-personalization`,
    appearance: `${tabGroupId}-tab-appearance`,
    audio: `${tabGroupId}-tab-audio`,
    serversTools: `${tabGroupId}-tab-servers-tools`,
    data: `${tabGroupId}-tab-data`,
  } satisfies Record<PreferencesTab, string>;

  const panelIds = {
    personalization: `${tabGroupId}-panel-personalization`,
    appearance: `${tabGroupId}-panel-appearance`,
    audio: `${tabGroupId}-panel-audio`,
    serversTools: `${tabGroupId}-panel-servers-tools`,
    data: `${tabGroupId}-panel-data`,
  } satisfies Record<PreferencesTab, string>;
  /* eslint-enable lingui/no-unlocalized-strings */

  const handleSave = async () => {
    setSaveError(null);
    setIsSaving(true);
    try {
      const requestBody: UpdateProfilePreferencesRequest = {
        preference_nickname: toNullableValue(nickname),
        preference_job_title: toNullableValue(jobTitle),
        preference_assistant_custom_instructions:
          toNullableValue(customInstructions),
        preference_assistant_additional_information: toNullableValue(
          additionalInformation,
        ),
        preference_default_chat_provider:
          defaultModel?.chat_provider_id ?? null,
        // All three fields go out explicitly on every save: this PUT carries
        // all preference fields, so omitting them would let an unrelated edit
        // wipe the start-screen state. Null ids alone mean "inherit", so the
        // clear needs its own boolean.
        preference_starting_hub_assistant_id: resolvedStartingHubAssistantId,
        preference_starting_assistant_id: resolvedStartingAssistantId,
        preference_starting_assistant_cleared: resolvedStartingAssistantCleared,
      };

      await fetchUpdateProfilePreferences({
        body: requestBody,
      });
      await queryClient.invalidateQueries({
        queryKey: profileQuery({}).queryKey,
      });
      // The landing redirect reads the server-resolved answer, so refresh it
      // too.
      await queryClient.invalidateQueries({
        queryKey: startingAssistantQuery({}).queryKey,
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
      // Every chat is archived, so the whole per-chat prefix is stale — chat
      // detail above all, which is where a surface reads archived_at.
      const perChatQueryKey = chatDetailQuery({
        pathParams: { chatId: "" },
      }).queryKey.slice(0, -1);

      await archiveAllChatsMutation({});
      await queryClient.invalidateQueries({ queryKey: recentChatsQueryKey });
      await queryClient.invalidateQueries({ queryKey: perChatQueryKey });
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

  // Disconnecting reports the same way authorizing does: the row carries the
  // wait, a toast states the outcome. The two halves of one connection must
  // not answer in two different places.
  const handleDisconnectMcpOauth = async (serverId: string) => {
    setDisconnectingServerId(serverId);
    clearMcpAuthorization(serverId);

    try {
      await disconnectMcpServerOauthMutation({
        pathParams: { serverId },
      });
      // The row is expanded (Disconnect lives in its details), so its cached
      // roster would otherwise outlive the session it was listed through.
      await queryClient.invalidateQueries({
        queryKey: listMcpServerToolsQuery({ pathParams: { serverId } })
          .queryKey,
      });
      await refetchMcpServers();
      toast.success({
        dedupeKey: mcpAuthorizationToastKey(serverId),
        title: t({
          id: "preferences.dialog.mcpServers.oauth.disconnectSuccess",
          message: "Disconnected successfully.",
        }),
      });
    } catch {
      toast.error({
        dedupeKey: mcpAuthorizationToastKey(serverId),
        title: t({
          id: "preferences.dialog.mcpServers.oauth.disconnectError",
          message: "Could not disconnect. Please try again.",
        }),
      });
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
          <TabRail
            variant="rail"
            orientation="vertical"
            // The rail announces itself as vertical but lays out as a
            // horizontal strip below `md`, so both arrow pairs have to work.
            arrowKeys="both"
            aria-label={t({
              id: "preferences.dialog.title",
              message: "Preferences",
            })}
            className="overflow-x-auto md:flex-col md:overflow-x-visible"
            tabClassName="text-left md:w-full"
            options={visibleTabs.map((tab) => ({
              value: tab,
              label: tabLabels[tab],
              icon: tabIcons[tab],
              id: tabIds[tab],
              panelId: panelIds[tab],
            }))}
            value={activeTab}
            onChange={setActiveTab}
          />
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
                {availableModels.length > 0 ? (
                  <FormField
                    label={t({
                      id: "preferences.dialog.fields.defaultModel.label",
                      message: "Default model",
                    })}
                    htmlFor="model-selector-dropdown"
                  >
                    <ModelSelector
                      availableModels={availableModels}
                      selectedModel={defaultModel}
                      onModelChange={setDefaultModel}
                      allowNoSelection
                      onClearSelection={() => setDefaultModel(null)}
                      align="left"
                    />
                  </FormField>
                ) : null}

                {startScreenSettingEnabled ? (
                  <StartingAssistantSetting
                    choice={startScreenChoice}
                    onChoiceChange={setStartScreenChoice}
                    selectedPick={startingAssistantPick}
                    onSelectPick={setStartingAssistantPick}
                    hubOptions={hubOptions}
                    assistantOptions={assistantOptions}
                    isLoadingOptions={
                      isLoadingHubAssistants || isLoadingAssistants
                    }
                  />
                ) : null}

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

              <TextSizeSetting />
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
                <AudioInputTabContent
                  isActive={isOpen && activeTab === "audio"}
                />
              </section>
            ) : null}

            <section
              id={panelIds.serversTools}
              role="tabpanel"
              aria-labelledby={tabIds.serversTools}
              hidden={activeTab !== "serversTools"}
              className="space-y-4"
            >
              <div className="space-y-1">
                <h2 className="text-sm font-medium text-theme-fg-primary">
                  {t({
                    id: "preferences.dialog.serversTools.heading",
                    message: "MCP & Apps",
                  })}
                </h2>
                <p className="text-sm text-theme-fg-secondary">
                  {t({
                    id: "preferences.dialog.serversTools.description",
                    message:
                      "Everything the assistant can connect to or act through. Open an entry to fix its connection or adjust what it may do.",
                  })}
                </p>
              </div>

              {activeTab === "serversTools" ? (
                <ServersToolsPane
                  isActive={isOpen}
                  mcp={
                    mcpServersTabEnabled
                      ? {
                          onAuthorize: (serverId) => {
                            void startMcpAuthorization(serverId);
                          },
                          onDisconnect: (serverId) => {
                            void handleDisconnectMcpOauth(serverId);
                          },
                          selectedServerId: selectedMcpServerId,
                          disconnectingServerId,
                        }
                      : null
                  }
                  showDesktopSidecar={desktopSidecarTabEnabled}
                />
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
                      "This will archive every non-archived chat in your account. You can unarchive individual chats afterwards.",
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
                disabled={isSaving || !hasChanges || startScreenIsIncomplete}
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
