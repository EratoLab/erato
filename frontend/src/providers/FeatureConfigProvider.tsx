"use client";

import { createContext, useContext, useMemo } from "react";

import { env } from "@/app/env";

import type { ReactNode } from "react";

/**
 * Configuration for upload-related features
 */
interface UploadFeatureConfig {
  /** Whether file upload functionality is enabled */
  enabled: boolean;
  /** Maximum upload size in bytes */
  maxSizeBytes: number;
  /** Human-readable max upload size (e.g., "10 MB", "2 GB") */
  maxSizeFormatted: string;
}

/**
 * Configuration for chat input features
 */
interface ChatInputFeatureConfig {
  /** Whether the chat input should auto-focus on mount */
  autofocus: boolean;
  /** Layout of the chat input before a conversation has started */
  emptyStateLayout: "bottom" | "centered";
  /** Whether to show the AI usage advisory below the chat input */
  showUsageAdvisory: boolean;
}

/**
 * Configuration for authentication/account features
 */
interface AuthFeatureConfig {
  /** Whether to show the logout button/link */
  showLogout: boolean;
}

/**
 * Configuration for assistants feature
 */
interface AssistantsFeatureConfig {
  /** Whether the assistants feature is enabled */
  enabled: boolean;
  /** Whether recent assistants should be shown in the sidebar */
  showRecentItems: boolean;
  /** Threshold at or above which assistant editor context warnings are shown */
  contextWarningThreshold: number;
  /** Threshold at or above which files are listed as major context contributors */
  contextFileContributorThreshold: number;
}

interface StarterPromptsFeatureConfig {
  /** Whether starter prompts are enabled */
  enabled: boolean;
}

/**
 * Configuration for user preferences feature
 */
interface UserPreferencesFeatureConfig {
  /** Whether the user preferences feature is enabled */
  enabled: boolean;
  /** Whether the MCP servers tab is shown in the preferences dialog */
  mcpServersTabEnabled: boolean;
}

/**
 * Cloud provider type
 */
export type CloudProvider = "sharepoint" | "googledrive";

/**
 * Configuration for cloud file providers
 */
interface CloudProvidersFeatureConfig {
  /** List of available cloud file providers */
  availableProviders: CloudProvider[];
}

/**
 * Configuration for message feedback feature
 */
export interface MessageFeedbackFeatureConfig {
  /** Whether message feedback (thumbs up/down) is enabled */
  enabled: boolean;
  /** Whether comment text field is enabled in feedback dialog */
  commentsEnabled: boolean;
  /** Time limit in seconds for editing feedback after creation (null = unlimited) */
  editTimeLimitSeconds: number | null;
}

/**
 * Configuration for sidebar feature
 */
interface SidebarFeatureConfig {
  /** Behavior of the collapsed sidebar state: "hidden" or "slim" (icon-only) */
  collapsedMode: "hidden" | "slim";
  /** Optional path to sidebar-specific logo */
  logoPath: string | null;
  /** Optional path to sidebar-specific logo for dark mode */
  logoDarkPath: string | null;
  /** Whether to show metadata (timestamps and file count) in chat history items */
  chatHistoryShowMetadata: boolean;
}

interface ChatSharingFeatureConfig {
  /** Whether chat sharing is enabled */
  enabled: boolean;
}

/**
 * Complete feature configuration interface
 */
export interface FeatureConfig {
  /** Upload-related feature flags */
  upload: UploadFeatureConfig;
  /** Chat input feature flags */
  chatInput: ChatInputFeatureConfig;
  /** Authentication feature flags */
  auth: AuthFeatureConfig;
  /** Assistants feature flags */
  assistants: AssistantsFeatureConfig;
  /** User preferences feature flags */
  userPreferences: UserPreferencesFeatureConfig;
  /** Starter prompts feature flags */
  starterPrompts: StarterPromptsFeatureConfig;
  /** Cloud providers feature flags */
  cloudProviders: CloudProvidersFeatureConfig;
  /** Message feedback feature flags */
  messageFeedback: MessageFeedbackFeatureConfig;
  /** Sidebar feature flags */
  sidebar: SidebarFeatureConfig;
  /** Chat sharing feature flags */
  chatSharing: ChatSharingFeatureConfig;
}

const FeatureConfigContext = createContext<FeatureConfig | null>(null);

export const defaultStaticFeatureConfig: FeatureConfig = {
  upload: {
    enabled: true,
    maxSizeBytes: 20 * 1024 * 1024,
    maxSizeFormatted: "20 MB",
  },
  chatInput: {
    autofocus: true,
    emptyStateLayout: "bottom",
    showUsageAdvisory: true,
  },
  auth: {
    showLogout: false,
  },
  assistants: {
    enabled: false,
    showRecentItems: false,
    contextWarningThreshold: 0.5,
    contextFileContributorThreshold: 0.05,
  },
  starterPrompts: {
    enabled: false,
  },
  userPreferences: {
    enabled: false,
    mcpServersTabEnabled: false,
  },
  cloudProviders: {
    availableProviders: [],
  },
  messageFeedback: {
    enabled: false,
    commentsEnabled: false,
    editTimeLimitSeconds: null,
  },
  sidebar: {
    collapsedMode: "hidden",
    logoPath: null,
    logoDarkPath: null,
    chatHistoryShowMetadata: true,
  },
  chatSharing: {
    enabled: false,
  },
};

/**
 * Formats bytes into a human-readable string (MB or GB)
 * @param bytes - The number of bytes to format
 * @returns Formatted string like "10 MB" or "2.5 GB"
 */
function formatBytes(bytes: number): string {
  const GB = 1024 * 1024 * 1024;
  const MB = 1024 * 1024;

  if (bytes >= GB) {
    return `${(bytes / GB).toFixed(1)} GB`;
  }
  return `${Math.round(bytes / MB)} MB`;
}

function createFeatureConfig(
  environment: ReturnType<typeof env>,
): FeatureConfig {
  const availableProviders: CloudProvider[] = [];
  if (environment.sharepointEnabled) {
    availableProviders.push("sharepoint");
  }

  return {
    upload: {
      enabled: !environment.disableUpload,
      maxSizeBytes: environment.maxUploadSizeBytes,
      maxSizeFormatted: formatBytes(environment.maxUploadSizeBytes),
    },
    chatInput: {
      autofocus: !environment.disableChatInputAutofocus,
      emptyStateLayout: environment.chatInputEmptyStateLayout,
      showUsageAdvisory: true,
    },
    auth: {
      showLogout: !environment.disableLogout,
    },
    assistants: {
      enabled: environment.assistantsEnabled,
      showRecentItems: environment.assistantsShowRecentItems,
      contextWarningThreshold: environment.assistantContextWarningThreshold,
      contextFileContributorThreshold:
        environment.assistantContextFileContributorThreshold,
    },
    starterPrompts: {
      enabled: environment.starterPromptsEnabled,
    },
    userPreferences: {
      enabled: environment.userPreferencesEnabled,
      mcpServersTabEnabled: environment.mcpServersTabEnabled,
    },
    cloudProviders: {
      availableProviders,
    },
    messageFeedback: {
      enabled: environment.messageFeedbackEnabled,
      commentsEnabled: environment.messageFeedbackCommentsEnabled,
      editTimeLimitSeconds: environment.messageFeedbackEditTimeLimitSeconds,
    },
    sidebar: {
      collapsedMode: environment.sidebarCollapsedMode,
      logoPath: environment.sidebarLogoPath,
      logoDarkPath: environment.sidebarLogoDarkPath,
      chatHistoryShowMetadata: environment.sidebarChatHistoryShowMetadata,
    },
    chatSharing: {
      enabled: environment.chatSharingEnabled,
    },
  };
}

function mergeFeatureConfig(overrides?: Partial<FeatureConfig>): FeatureConfig {
  if (!overrides) {
    return defaultStaticFeatureConfig;
  }

  return {
    upload: { ...defaultStaticFeatureConfig.upload, ...overrides.upload },
    chatInput: {
      ...defaultStaticFeatureConfig.chatInput,
      ...overrides.chatInput,
    },
    auth: { ...defaultStaticFeatureConfig.auth, ...overrides.auth },
    assistants: {
      ...defaultStaticFeatureConfig.assistants,
      ...overrides.assistants,
    },
    starterPrompts: {
      ...defaultStaticFeatureConfig.starterPrompts,
      ...overrides.starterPrompts,
    },
    userPreferences: {
      ...defaultStaticFeatureConfig.userPreferences,
      ...overrides.userPreferences,
    },
    cloudProviders: {
      ...defaultStaticFeatureConfig.cloudProviders,
      ...overrides.cloudProviders,
    },
    messageFeedback: {
      ...defaultStaticFeatureConfig.messageFeedback,
      ...overrides.messageFeedback,
    },
    sidebar: { ...defaultStaticFeatureConfig.sidebar, ...overrides.sidebar },
    chatSharing: {
      ...defaultStaticFeatureConfig.chatSharing,
      ...overrides.chatSharing,
    },
  };
}

/**
 * Provider component that makes feature configuration available throughout the app.
 *
 * This provider reads environment configuration once during initialization and provides
 * it via React Context, following the same pattern as ThemeProvider and ApiProvider.
 *
 * Usage:
 * ```tsx
 * <FeatureConfigProvider>
 *   <App />
 * </FeatureConfigProvider>
 * ```
 *
 * @example
 * // In a component:
 * const { enabled } = useUploadFeature();
 * if (enabled) {
 *   return <FileUploadButton />;
 * }
 */
export function FeatureConfigProvider({
  children,
  config,
}: {
  children: ReactNode;
  config?: Partial<FeatureConfig>;
}) {
  const resolvedConfig = useMemo<FeatureConfig>(
    () => (config ? mergeFeatureConfig(config) : createFeatureConfig(env())),
    [config],
  );

  return (
    <FeatureConfigContext.Provider value={resolvedConfig}>
      {children}
    </FeatureConfigContext.Provider>
  );
}

export function StaticFeatureConfigProvider({
  children,
  config,
}: {
  children: ReactNode;
  config?: Partial<FeatureConfig>;
}) {
  const mergedConfig = useMemo(() => mergeFeatureConfig(config), [config]);

  return (
    <FeatureConfigContext.Provider value={mergedConfig}>
      {children}
    </FeatureConfigContext.Provider>
  );
}

/**
 * Hook to access the complete feature configuration.
 *
 * @throws {Error} If used outside of FeatureConfigProvider
 *
 * @example
 * ```tsx
 * const config = useFeatureConfig();
 * if (config.upload.enabled && config.auth.showLogout) {
 *   // Both features are enabled
 * }
 * ```
 */
export function useFeatureConfig(): FeatureConfig {
  const context = useContext(FeatureConfigContext);
  if (!context) {
    throw new Error(
      "useFeatureConfig must be used within a FeatureConfigProvider",
    );
  }
  return context;
}

/**
 * Convenience hook for accessing upload feature configuration.
 *
 * @returns Upload feature configuration
 * @throws {Error} If used outside of FeatureConfigProvider
 *
 * @example
 * ```tsx
 * const { enabled } = useUploadFeature();
 * return enabled ? <FileUploadButton /> : null;
 * ```
 */
export function useUploadFeature(): UploadFeatureConfig {
  const config = useFeatureConfig();
  return config.upload;
}

/**
 * Convenience hook for accessing chat input feature configuration.
 *
 * @returns Chat input feature configuration
 * @throws {Error} If used outside of FeatureConfigProvider
 *
 * @example
 * ```tsx
 * const { autofocus } = useChatInputFeature();
 * return <textarea autoFocus={autofocus} />;
 * ```
 */
export function useChatInputFeature(): ChatInputFeatureConfig {
  const config = useFeatureConfig();
  return config.chatInput;
}

/**
 * Convenience hook for accessing authentication feature configuration.
 *
 * @returns Authentication feature configuration
 * @throws {Error} If used outside of FeatureConfigProvider
 *
 * @example
 * ```tsx
 * const { showLogout } = useAuthFeature();
 * return showLogout ? <LogoutButton /> : null;
 * ```
 */
export function useAuthFeature(): AuthFeatureConfig {
  const config = useFeatureConfig();
  return config.auth;
}

/**
 * Convenience hook for accessing assistants feature configuration.
 *
 * @returns Assistants feature configuration
 * @throws {Error} If used outside of FeatureConfigProvider
 *
 * @example
 * ```tsx
 * const { enabled } = useAssistantsFeature();
 * return enabled ? <FrequentAssistantsList /> : null;
 * ```
 */
export function useAssistantsFeature(): AssistantsFeatureConfig {
  const config = useFeatureConfig();
  return config.assistants;
}

export function useStarterPromptsFeature(): StarterPromptsFeatureConfig {
  const config = useFeatureConfig();
  return config.starterPrompts;
}

/**
 * Convenience hook for accessing user preferences feature configuration.
 *
 * @returns User preferences feature configuration
 * @throws {Error} If used outside of FeatureConfigProvider
 */
export function useUserPreferencesFeature(): UserPreferencesFeatureConfig {
  const config = useFeatureConfig();
  return config.userPreferences;
}

/**
 * Convenience hook for accessing cloud providers feature configuration.
 *
 * @returns Cloud providers feature configuration
 * @throws {Error} If used outside of FeatureConfigProvider
 *
 * @example
 * ```tsx
 * const { availableProviders } = useCloudProvidersFeature();
 * const hasCloudProviders = availableProviders.length > 0;
 * ```
 */
export function useCloudProvidersFeature(): CloudProvidersFeatureConfig {
  const config = useFeatureConfig();
  return config.cloudProviders;
}

/**
 * Convenience hook for accessing message feedback feature configuration.
 *
 * @returns Message feedback feature configuration
 * @throws {Error} If used outside of FeatureConfigProvider
 *
 * @example
 * ```tsx
 * const { enabled, commentsEnabled } = useMessageFeedbackFeature();
 * if (enabled) {
 *   return <FeedbackButtons showComments={commentsEnabled} />;
 * }
 * ```
 */
export function useMessageFeedbackFeature(): MessageFeedbackFeatureConfig {
  const config = useFeatureConfig();
  return config.messageFeedback;
}

/**
 * Convenience hook for accessing sidebar feature configuration.
 *
 * @returns Sidebar feature configuration
 * @throws {Error} If used outside of FeatureConfigProvider
 *
 * @example
 * ```tsx
 * const { collapsedMode, logoPath } = useSidebarFeature();
 * const isSlimMode = collapsed && collapsedMode === "slim";
 * ```
 */
export function useSidebarFeature(): SidebarFeatureConfig {
  const config = useFeatureConfig();
  return config.sidebar;
}

export function useChatSharingFeature(): ChatSharingFeatureConfig {
  const config = useFeatureConfig();
  return config.chatSharing;
}
