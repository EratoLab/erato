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
}

/**
 * Configuration for chat input features
 */
interface ChatInputFeatureConfig {
  /** Whether the chat input should auto-focus on mount */
  autofocus: boolean;
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
 * Complete feature configuration interface
 */
interface FeatureConfig {
  /** Upload-related feature flags */
  upload: UploadFeatureConfig;
  /** Chat input feature flags */
  chatInput: ChatInputFeatureConfig;
  /** Authentication feature flags */
  auth: AuthFeatureConfig;
  /** Assistants feature flags */
  assistants: AssistantsFeatureConfig;
  /** Cloud providers feature flags */
  cloudProviders: CloudProvidersFeatureConfig;
}

const FeatureConfigContext = createContext<FeatureConfig | null>(null);

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
export function FeatureConfigProvider({ children }: { children: ReactNode }) {
  // Call env() once during initialization and compute feature config
  const config = useMemo<FeatureConfig>(() => {
    const environment = env();

    // Build list of available cloud providers based on feature flags
    const availableProviders: CloudProvider[] = [];
    if (environment.sharepointEnabled) {
      availableProviders.push("sharepoint");
    }
    // Future: Add Google Drive when available
    // if (environment.googleDriveEnabled) {
    //   availableProviders.push("googledrive");
    // }

    return {
      upload: {
        enabled: !environment.disableUpload,
      },
      chatInput: {
        autofocus: !environment.disableChatInputAutofocus,
      },
      auth: {
        showLogout: !environment.disableLogout,
      },
      assistants: {
        enabled: environment.assistantsEnabled,
      },
      cloudProviders: {
        availableProviders,
      },
    };
  }, []); // Empty deps - only compute once

  return (
    <FeatureConfigContext.Provider value={config}>
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
