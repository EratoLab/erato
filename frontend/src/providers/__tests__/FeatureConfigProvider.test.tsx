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
} from "../FeatureConfigProvider";

import type { ReactNode } from "react";

const mockEnv = env as ReturnType<typeof vi.fn>;

// Helper to create wrapper with provider
function createWrapper() {
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: ReactNode }) => (
    <FeatureConfigProvider>{children}</FeatureConfigProvider>
  );
}

describe("FeatureConfigProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock: all features enabled (nothing disabled)
    mockEnv.mockReturnValue({
      apiRootUrl: "/api/",
      themeCustomerName: null,
      themePath: null,
      themeConfigPath: null,
      themeLogoPath: null,
      themeLogoDarkPath: null,
      disableUpload: false,
      disableChatInputAutofocus: false,
      disableLogout: false,
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
        },
        chatInput: {
          autofocus: true,
        },
        auth: {
          showLogout: true,
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
        disableUpload: true, // Disabled
        disableChatInputAutofocus: false,
        disableLogout: false,
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
        disableUpload: false,
        disableChatInputAutofocus: true, // Disabled
        disableLogout: false,
      });

      const { result } = renderHook(() => useFeatureConfig(), {
        wrapper: createWrapper(),
      });

      expect(result.current.upload.enabled).toBe(true);
      expect(result.current.chatInput.autofocus).toBe(false);
      expect(result.current.auth.showLogout).toBe(true);
    });

    it("should return config with logout hidden when disableLogout is true", () => {
      mockEnv.mockReturnValue({
        apiRootUrl: "/api/",
        themeCustomerName: null,
        themePath: null,
        themeConfigPath: null,
        themeLogoPath: null,
        themeLogoDarkPath: null,
        disableUpload: false,
        disableChatInputAutofocus: false,
        disableLogout: true, // Disabled
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
        disableUpload: true,
        disableChatInputAutofocus: true,
        disableLogout: true,
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
        disableUpload: true,
        disableChatInputAutofocus: false,
        disableLogout: false,
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
        disableUpload: false,
        disableChatInputAutofocus: true,
        disableLogout: false,
      });

      const { result } = renderHook(() => useChatInputFeature(), {
        wrapper: createWrapper(),
      });

      expect(result.current.autofocus).toBe(false);
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
        disableUpload: false,
        disableChatInputAutofocus: false,
        disableLogout: true,
      });

      const { result } = renderHook(() => useAuthFeature(), {
        wrapper: createWrapper(),
      });

      expect(result.current.showLogout).toBe(false);
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
});
