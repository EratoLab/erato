import { renderHook } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock the env function
vi.mock("@/app/env", () => ({
  env: vi.fn(),
}));

// Import the mocked env
import { env } from "@/app/env";

import {
  FeatureConfigProvider,
  useFeatureConfig,
  useUploadFeature,
  useChatInputFeature,
  useAuthFeature,
  useAssistantsFeature,
  useMessageFeedbackFeature,
  useSidebarFeature,
  useUserPreferencesFeature,
} from "../FeatureConfigProvider";

import type { ReactNode } from "react";

const mockEnv = env as ReturnType<typeof vi.fn>;

// Helper to create wrapper with provider
function createWrapper(
  config?: Parameters<typeof FeatureConfigProvider>[0]["config"],
) {
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: ReactNode }) => (
    <FeatureConfigProvider config={config}>{children}</FeatureConfigProvider>
  );
}

describe("FeatureConfigProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock: all features enabled (nothing disabled)
    mockEnv.mockReturnValue({
      apiRootUrl: "/api/",
      frontendPlatform: "common",
      frontendPublicBasePath: "/public/common",
      commonPublicBasePath: "/public/common",
      themeCustomerName: null,
      themePath: null,
      themeConfigPath: null,
      themeLogoPath: null,
      themeLogoDarkPath: null,
      themeAssistantAvatarPath: null,
      disableUpload: false,
      disableChatInputAutofocus: false,
      chatInputEmptyStateLayout: "bottom",
      disableLogout: false,
      assistantsEnabled: false,
      assistantsShowRecentItems: false,
      assistantContextWarningThreshold: 0.5,
      assistantContextFileContributorThreshold: 0.05,
      starterPromptsEnabled: false,
      promptOptimizerEnabled: false,
      mcpServersTabEnabled: false,
      sharepointEnabled: false,
      messageFeedbackEnabled: false,
      messageFeedbackCommentsEnabled: false,
      userPreferencesEnabled: true,
      messageFeedbackEditTimeLimitSeconds: null,
      maxUploadSizeBytes: 20971520, // 20 MB - matches backend default
      sidebarCollapsedMode: "hidden",
      sidebarLogoPath: null,
      sidebarLogoDarkPath: null,
      sidebarChatHistoryShowMetadata: true,
      chatSharingEnabled: false,
      msalClientId: null,
      msalAuthority: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("useFeatureConfig", () => {
    it("should throw error when used outside provider", () => {
      // Suppress console.error for this test
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      expect(() => {
        renderHook(() => useFeatureConfig());
      }).toThrow(
        "useFeatureConfig must be used within a FeatureConfigProvider",
      );

      consoleErrorSpy.mockRestore();
    });

    it("should return complete config when all features are enabled", () => {
      const { result } = renderHook(() => useFeatureConfig(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toEqual({
        upload: {
          enabled: true,
          maxSizeBytes: 20971520,
          maxSizeFormatted: "20 MB",
        },
        chatInput: {
          autofocus: true,
          emptyStateLayout: "bottom",
          showUsageAdvisory: true,
        },
        chatSharing: {
          enabled: false,
        },
        auth: {
          showLogout: true,
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
          enabled: true,
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
      });
    });

    it("should return config with upload disabled when disableUpload is true", () => {
      mockEnv.mockReturnValue({
        apiRootUrl: "/api/",
        themeCustomerName: null,
        themePath: null,
        themeConfigPath: null,
        themeLogoPath: null,
        themeLogoDarkPath: null,
        themeAssistantAvatarPath: null,
        disableUpload: true, // Disabled
        disableChatInputAutofocus: false,
        disableLogout: false,
        assistantsEnabled: false,
        assistantsShowRecentItems: false,
        sharepointEnabled: false,
        messageFeedbackEnabled: false,
        messageFeedbackCommentsEnabled: false,
        userPreferencesEnabled: true,
        messageFeedbackEditTimeLimitSeconds: null,
        maxUploadSizeBytes: 20971520,
        sidebarCollapsedMode: "hidden",
        sidebarLogoPath: null,
        sidebarLogoDarkPath: null,
      });

      const { result } = renderHook(() => useFeatureConfig(), {
        wrapper: createWrapper(),
      });

      expect(result.current.upload.enabled).toBe(false);
      expect(result.current.chatInput.autofocus).toBe(true);
      expect(result.current.auth.showLogout).toBe(true);
    });

    it("should return config with autofocus disabled when disableChatInputAutofocus is true", () => {
      mockEnv.mockReturnValue({
        apiRootUrl: "/api/",
        themeCustomerName: null,
        themePath: null,
        themeConfigPath: null,
        themeLogoPath: null,
        themeLogoDarkPath: null,
        themeAssistantAvatarPath: null,
        disableUpload: false,
        disableChatInputAutofocus: true, // Disabled
        disableLogout: false,
        assistantsEnabled: false,
        assistantsShowRecentItems: false,
        sharepointEnabled: false,
        messageFeedbackEnabled: false,
        messageFeedbackCommentsEnabled: false,
        userPreferencesEnabled: true,
        messageFeedbackEditTimeLimitSeconds: null,
        maxUploadSizeBytes: 20971520,
        sidebarCollapsedMode: "hidden",
        sidebarLogoPath: null,
        sidebarLogoDarkPath: null,
      });

      const { result } = renderHook(() => useFeatureConfig(), {
        wrapper: createWrapper(),
      });

      expect(result.current.upload.enabled).toBe(true);
      expect(result.current.chatInput.autofocus).toBe(false);
      expect(result.current.chatInput.showUsageAdvisory).toBe(true);
      expect(result.current.auth.showLogout).toBe(true);
    });

    it("should allow overriding chat input advisory visibility", () => {
      const { result } = renderHook(() => useFeatureConfig(), {
        wrapper: createWrapper({
          chatInput: { showUsageAdvisory: false },
        }),
      });

      expect(result.current.chatInput).toEqual({
        autofocus: true,
        emptyStateLayout: "bottom",
        showUsageAdvisory: false,
      });
    });

    it("should return config with logout hidden when disableLogout is true", () => {
      mockEnv.mockReturnValue({
        apiRootUrl: "/api/",
        themeCustomerName: null,
        themePath: null,
        themeConfigPath: null,
        themeLogoPath: null,
        themeLogoDarkPath: null,
        themeAssistantAvatarPath: null,
        disableUpload: false,
        disableChatInputAutofocus: false,
        disableLogout: true, // Disabled
        assistantsEnabled: false,
        assistantsShowRecentItems: false,
        sharepointEnabled: false,
        messageFeedbackEnabled: false,
        messageFeedbackCommentsEnabled: false,
        userPreferencesEnabled: true,
        messageFeedbackEditTimeLimitSeconds: null,
        maxUploadSizeBytes: 20971520,
        sidebarCollapsedMode: "hidden",
        sidebarLogoPath: null,
        sidebarLogoDarkPath: null,
      });

      const { result } = renderHook(() => useFeatureConfig(), {
        wrapper: createWrapper(),
      });

      expect(result.current.upload.enabled).toBe(true);
      expect(result.current.chatInput.autofocus).toBe(true);
      expect(result.current.auth.showLogout).toBe(false);
    });

    it("should handle all features disabled simultaneously", () => {
      mockEnv.mockReturnValue({
        apiRootUrl: "/api/",
        themeCustomerName: null,
        themePath: null,
        themeConfigPath: null,
        themeLogoPath: null,
        themeLogoDarkPath: null,
        themeAssistantAvatarPath: null,
        disableUpload: true,
        disableChatInputAutofocus: true,
        disableLogout: true,
        assistantsEnabled: false,
        assistantsShowRecentItems: false,
        sharepointEnabled: false,
        messageFeedbackEnabled: false,
        messageFeedbackCommentsEnabled: false,
        userPreferencesEnabled: true,
        messageFeedbackEditTimeLimitSeconds: null,
        maxUploadSizeBytes: 20971520,
        sidebarCollapsedMode: "hidden",
        sidebarLogoPath: null,
        sidebarLogoDarkPath: null,
      });

      const { result } = renderHook(() => useFeatureConfig(), {
        wrapper: createWrapper(),
      });

      expect(result.current.upload.enabled).toBe(false);
      expect(result.current.chatInput.autofocus).toBe(false);
      expect(result.current.auth.showLogout).toBe(false);
    });
  });

  describe("useUploadFeature", () => {
    it("should throw error when used outside provider", () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      expect(() => {
        renderHook(() => useUploadFeature());
      }).toThrow(
        "useFeatureConfig must be used within a FeatureConfigProvider",
      );

      consoleErrorSpy.mockRestore();
    });

    it("should return upload config with enabled true when not disabled", () => {
      const { result } = renderHook(() => useUploadFeature(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toEqual({
        enabled: true,
        maxSizeBytes: 20971520,
        maxSizeFormatted: "20 MB",
      });
    });

    it("should return upload config with enabled false when disabled", () => {
      mockEnv.mockReturnValue({
        apiRootUrl: "/api/",
        themeCustomerName: null,
        themePath: null,
        themeConfigPath: null,
        themeLogoPath: null,
        themeLogoDarkPath: null,
        themeAssistantAvatarPath: null,
        disableUpload: true,
        disableChatInputAutofocus: false,
        disableLogout: false,
        assistantsEnabled: false,
        assistantsShowRecentItems: false,
        sharepointEnabled: false,
        messageFeedbackEnabled: false,
        messageFeedbackCommentsEnabled: false,
        userPreferencesEnabled: true,
        messageFeedbackEditTimeLimitSeconds: null,
        maxUploadSizeBytes: 20971520,
        sidebarCollapsedMode: "hidden",
        sidebarLogoPath: null,
        sidebarLogoDarkPath: null,
      });

      const { result } = renderHook(() => useUploadFeature(), {
        wrapper: createWrapper(),
      });

      expect(result.current.enabled).toBe(false);
    });
  });

  describe("useChatInputFeature", () => {
    it("should throw error when used outside provider", () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      expect(() => {
        renderHook(() => useChatInputFeature());
      }).toThrow(
        "useFeatureConfig must be used within a FeatureConfigProvider",
      );

      consoleErrorSpy.mockRestore();
    });

    it("should return chat input config with autofocus true when not disabled", () => {
      const { result } = renderHook(() => useChatInputFeature(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toEqual({
        autofocus: true,
        emptyStateLayout: "bottom",
        showUsageAdvisory: true,
      });
    });

    it("should return chat input config with autofocus false when disabled", () => {
      mockEnv.mockReturnValue({
        apiRootUrl: "/api/",
        themeCustomerName: null,
        themePath: null,
        themeConfigPath: null,
        themeLogoPath: null,
        themeLogoDarkPath: null,
        themeAssistantAvatarPath: null,
        disableUpload: false,
        disableChatInputAutofocus: true,
        disableLogout: false,
        assistantsEnabled: false,
        assistantsShowRecentItems: false,
        sharepointEnabled: false,
        messageFeedbackEnabled: false,
        messageFeedbackCommentsEnabled: false,
        userPreferencesEnabled: true,
        messageFeedbackEditTimeLimitSeconds: null,
        maxUploadSizeBytes: 20971520,
        sidebarCollapsedMode: "hidden",
        sidebarLogoPath: null,
        sidebarLogoDarkPath: null,
      });

      const { result } = renderHook(() => useChatInputFeature(), {
        wrapper: createWrapper(),
      });

      expect(result.current.autofocus).toBe(false);
    });

    it("should return a centered empty-state layout when configured", () => {
      mockEnv.mockReturnValue({
        apiRootUrl: "/api/",
        themeCustomerName: null,
        themePath: null,
        themeConfigPath: null,
        themeLogoPath: null,
        themeLogoDarkPath: null,
        themeAssistantAvatarPath: null,
        disableUpload: false,
        disableChatInputAutofocus: false,
        chatInputEmptyStateLayout: "centered",
        disableLogout: false,
        assistantsEnabled: false,
        assistantsShowRecentItems: false,
        sharepointEnabled: false,
        messageFeedbackEnabled: false,
        messageFeedbackCommentsEnabled: false,
        userPreferencesEnabled: true,
        messageFeedbackEditTimeLimitSeconds: null,
        maxUploadSizeBytes: 20971520,
        sidebarCollapsedMode: "hidden",
        sidebarLogoPath: null,
        sidebarLogoDarkPath: null,
      });

      const { result } = renderHook(() => useChatInputFeature(), {
        wrapper: createWrapper(),
      });

      expect(result.current.emptyStateLayout).toBe("centered");
    });
  });

  describe("useAuthFeature", () => {
    it("should throw error when used outside provider", () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      expect(() => {
        renderHook(() => useAuthFeature());
      }).toThrow(
        "useFeatureConfig must be used within a FeatureConfigProvider",
      );

      consoleErrorSpy.mockRestore();
    });

    it("should return auth config with showLogout true when not disabled", () => {
      const { result } = renderHook(() => useAuthFeature(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toEqual({
        showLogout: true,
      });
    });

    it("should return auth config with showLogout false when disabled", () => {
      mockEnv.mockReturnValue({
        apiRootUrl: "/api/",
        themeCustomerName: null,
        themePath: null,
        themeConfigPath: null,
        themeLogoPath: null,
        themeLogoDarkPath: null,
        themeAssistantAvatarPath: null,
        disableUpload: false,
        disableChatInputAutofocus: false,
        disableLogout: true,
        assistantsEnabled: false,
        assistantsShowRecentItems: false,
        sharepointEnabled: false,
        messageFeedbackEnabled: false,
        messageFeedbackCommentsEnabled: false,
        userPreferencesEnabled: true,
        maxUploadSizeBytes: 20971520,
      });

      const { result } = renderHook(() => useAuthFeature(), {
        wrapper: createWrapper(),
      });

      expect(result.current.showLogout).toBe(false);
    });
  });

  describe("useAssistantsFeature", () => {
    it("should return assistants config with the default context warning threshold", () => {
      const { result } = renderHook(() => useAssistantsFeature(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toEqual({
        enabled: false,
        showRecentItems: false,
        contextWarningThreshold: 0.5,
        contextFileContributorThreshold: 0.05,
      });
    });

    it("should return configured assistants thresholds", () => {
      mockEnv.mockReturnValue({
        apiRootUrl: "/api/",
        themeCustomerName: null,
        themePath: null,
        themeConfigPath: null,
        themeLogoPath: null,
        themeLogoDarkPath: null,
        themeAssistantAvatarPath: null,
        disableUpload: false,
        disableChatInputAutofocus: false,
        disableLogout: false,
        assistantsEnabled: true,
        assistantsShowRecentItems: true,
        assistantContextWarningThreshold: 0.1,
        assistantContextFileContributorThreshold: 0.02,
        sharepointEnabled: false,
        messageFeedbackEnabled: false,
        messageFeedbackCommentsEnabled: false,
        userPreferencesEnabled: true,
        messageFeedbackEditTimeLimitSeconds: null,
        maxUploadSizeBytes: 20971520,
        sidebarCollapsedMode: "hidden",
        sidebarLogoPath: null,
        sidebarLogoDarkPath: null,
      });

      const { result } = renderHook(() => useAssistantsFeature(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toEqual({
        enabled: true,
        showRecentItems: true,
        contextWarningThreshold: 0.1,
        contextFileContributorThreshold: 0.02,
      });
    });
  });

  describe("useMessageFeedbackFeature", () => {
    it("should throw error when used outside provider", () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      expect(() => {
        renderHook(() => useMessageFeedbackFeature());
      }).toThrow(
        "useFeatureConfig must be used within a FeatureConfigProvider",
      );

      consoleErrorSpy.mockRestore();
    });

    it("should return message feedback config with both disabled by default", () => {
      const { result } = renderHook(() => useMessageFeedbackFeature(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toEqual({
        enabled: false,
        commentsEnabled: false,
        editTimeLimitSeconds: null,
      });
    });

    it("should return message feedback config with enabled true when enabled", () => {
      mockEnv.mockReturnValue({
        apiRootUrl: "/api/",
        themeCustomerName: null,
        themePath: null,
        themeConfigPath: null,
        themeLogoPath: null,
        themeLogoDarkPath: null,
        themeAssistantAvatarPath: null,
        disableUpload: false,
        disableChatInputAutofocus: false,
        disableLogout: false,
        assistantsEnabled: false,
        assistantsShowRecentItems: false,
        sharepointEnabled: false,
        messageFeedbackEnabled: true,
        messageFeedbackCommentsEnabled: false,
        userPreferencesEnabled: true,
        messageFeedbackEditTimeLimitSeconds: null,
        maxUploadSizeBytes: 20971520,
        sidebarCollapsedMode: "hidden",
        sidebarLogoPath: null,
        sidebarLogoDarkPath: null,
      });

      const { result } = renderHook(() => useMessageFeedbackFeature(), {
        wrapper: createWrapper(),
      });

      expect(result.current.enabled).toBe(true);
      expect(result.current.commentsEnabled).toBe(false);
      expect(result.current.editTimeLimitSeconds).toBe(null);
    });

    it("should return message feedback config with comments enabled when both are enabled", () => {
      mockEnv.mockReturnValue({
        apiRootUrl: "/api/",
        themeCustomerName: null,
        themePath: null,
        themeConfigPath: null,
        themeLogoPath: null,
        themeLogoDarkPath: null,
        themeAssistantAvatarPath: null,
        disableUpload: false,
        disableChatInputAutofocus: false,
        disableLogout: false,
        assistantsEnabled: false,
        assistantsShowRecentItems: false,
        sharepointEnabled: false,
        messageFeedbackEnabled: true,
        messageFeedbackCommentsEnabled: true,
        userPreferencesEnabled: true,
        messageFeedbackEditTimeLimitSeconds: null,
        maxUploadSizeBytes: 20971520,
        sidebarCollapsedMode: "hidden",
        sidebarLogoPath: null,
        sidebarLogoDarkPath: null,
      });

      const { result } = renderHook(() => useMessageFeedbackFeature(), {
        wrapper: createWrapper(),
      });

      expect(result.current.enabled).toBe(true);
      expect(result.current.commentsEnabled).toBe(true);
      expect(result.current.editTimeLimitSeconds).toBe(null);
    });
  });

  describe("useSidebarFeature", () => {
    it("should throw error when used outside provider", () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      expect(() => {
        renderHook(() => useSidebarFeature());
      }).toThrow(
        "useFeatureConfig must be used within a FeatureConfigProvider",
      );

      consoleErrorSpy.mockRestore();
    });

    it("should return default hidden mode when no config set", () => {
      const { result } = renderHook(() => useSidebarFeature(), {
        wrapper: createWrapper(),
      });

      expect(result.current).toEqual({
        collapsedMode: "hidden",
        logoPath: null,
        logoDarkPath: null,
        chatHistoryShowMetadata: true,
      });
    });

    it("should return slim mode when configured", () => {
      mockEnv.mockReturnValue({
        apiRootUrl: "/api/",
        themeCustomerName: null,
        themePath: null,
        themeConfigPath: null,
        themeLogoPath: null,
        themeLogoDarkPath: null,
        themeAssistantAvatarPath: null,
        disableUpload: false,
        disableChatInputAutofocus: false,
        disableLogout: false,
        assistantsEnabled: false,
        assistantsShowRecentItems: false,
        sharepointEnabled: false,
        messageFeedbackEnabled: false,
        messageFeedbackCommentsEnabled: false,
        userPreferencesEnabled: true,
        messageFeedbackEditTimeLimitSeconds: null,
        maxUploadSizeBytes: 20971520,
        sidebarCollapsedMode: "slim",
        sidebarLogoPath: "/custom-theme/sidebar-logo.svg",
        sidebarLogoDarkPath: "/custom-theme/sidebar-logo-dark.svg",
      });

      const { result } = renderHook(() => useSidebarFeature(), {
        wrapper: createWrapper(),
      });

      expect(result.current.collapsedMode).toBe("slim");
      expect(result.current.logoPath).toBe("/custom-theme/sidebar-logo.svg");
      expect(result.current.logoDarkPath).toBe(
        "/custom-theme/sidebar-logo-dark.svg",
      );
    });
  });

  describe("Config memoization", () => {
    it("should call env() only once during initialization", () => {
      const { rerender } = renderHook(() => useFeatureConfig(), {
        wrapper: createWrapper(),
      });

      expect(mockEnv).toHaveBeenCalledTimes(1);

      // Rerender should not call env() again
      rerender();
      expect(mockEnv).toHaveBeenCalledTimes(1);
    });
  });

  describe("useUserPreferencesFeature", () => {
    it("should return user preferences enabled by default", () => {
      const { result } = renderHook(() => useUserPreferencesFeature(), {
        wrapper: createWrapper(),
      });

      expect(result.current.enabled).toBe(true);
    });

    it("should return user preferences disabled when configured", () => {
      mockEnv.mockReturnValue({
        apiRootUrl: "/api/",
        themeCustomerName: null,
        themePath: null,
        themeConfigPath: null,
        themeLogoPath: null,
        themeLogoDarkPath: null,
        themeAssistantAvatarPath: null,
        disableUpload: false,
        disableChatInputAutofocus: false,
        disableLogout: false,
        assistantsEnabled: false,
        assistantsShowRecentItems: false,
        sharepointEnabled: false,
        messageFeedbackEnabled: false,
        messageFeedbackCommentsEnabled: false,
        userPreferencesEnabled: false,
        messageFeedbackEditTimeLimitSeconds: null,
        maxUploadSizeBytes: 20971520,
        sidebarCollapsedMode: "hidden",
        sidebarLogoPath: null,
        sidebarLogoDarkPath: null,
        sidebarChatHistoryShowMetadata: true,
      });

      const { result } = renderHook(() => useUserPreferencesFeature(), {
        wrapper: createWrapper(),
      });

      expect(result.current.enabled).toBe(false);
    });
  });
});
