import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the env module before other imports
vi.mock("@/app/env", () => ({
  env: vi.fn(),
}));

// eslint-disable-next-line import/order
import { env } from "@/app/env";
import {
  defaultThemeConfig,
  loadThemeConfig,
  resolveIconPaths,
} from "../themeConfig";

import type { Env } from "@/app/env";
import type { CustomThemeConfig } from "@/utils/themeUtils";

const mockEnv = env as ReturnType<typeof vi.fn>;

describe("themeConfig", () => {
  // Default env mock
  const createMockEnv = (overrides: Partial<Env> = {}): Env => ({
    apiRootUrl: "http://localhost:3000",
    themeCustomerName: null,
    themePath: null,
    themeConfigPath: null,
    themeLogoPath: null,
    themeLogoDarkPath: null,
    themeAssistantAvatarPath: null,
    sidebarLogoPath: null,
    sidebarLogoDarkPath: null,
    disableUpload: false,
    disableChatInputAutofocus: false,
    disableLogout: false,
    assistantsEnabled: false,
    promptOptimizerEnabled: false,
    sharepointEnabled: false,
    messageFeedbackEnabled: false,
    messageFeedbackCommentsEnabled: false,
    messageFeedbackEditTimeLimitSeconds: null,
    maxUploadSizeBytes: 20971520,
    sidebarCollapsedMode: "hidden",
    ...overrides,
  });

  beforeEach(() => {
    mockEnv.mockReturnValue(createMockEnv());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getLogoPath", () => {
    it("should handle light and dark mode variants with env vars", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themeLogoDarkPath: "/custom/dark-logo.svg",
          themeLogoPath: "/custom/light-logo.svg",
        }),
      );

      expect(defaultThemeConfig.getLogoPath(undefined, true)).toBe(
        "/custom/dark-logo.svg",
      );
      expect(defaultThemeConfig.getLogoPath(undefined, false)).toBe(
        "/custom/light-logo.svg",
      );
    });

    it("should handle dark mode with themePath", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themePath: "/themes/company",
        }),
      );

      expect(defaultThemeConfig.getLogoPath(undefined, true)).toBe(
        "/themes/company/logo-dark.svg",
      );
      expect(defaultThemeConfig.getLogoPath(undefined, false)).toBe(
        "/themes/company/logo.svg",
      );
    });

    it("should handle dark mode with themeCustomerName", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themeCustomerName: "acme",
        }),
      );

      expect(defaultThemeConfig.getLogoPath(undefined, true)).toBe(
        "/custom-theme/acme/logo-dark.svg",
      );
      expect(defaultThemeConfig.getLogoPath(undefined, false)).toBe(
        "/custom-theme/acme/logo.svg",
      );
    });

    it("should return default dark path when no overrides and dark mode requested", () => {
      expect(defaultThemeConfig.getLogoPath(undefined, true)).toBe(
        "/custom-theme/logo-dark.svg",
      );
    });

    it("should return env path when set", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themeLogoPath: "/custom/light-logo.svg",
        }),
      );

      expect(defaultThemeConfig.getLogoPath(undefined, false)).toBe(
        "/custom/light-logo.svg",
      );
    });

    it("should return themePath-based path when themePath is set", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themePath: "/themes/company",
        }),
      );

      expect(defaultThemeConfig.getLogoPath(undefined, false)).toBe(
        "/themes/company/logo.svg",
      );
    });

    it("should return customer-specific path when themeCustomerName is set", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themeCustomerName: "acme",
        }),
      );

      expect(defaultThemeConfig.getLogoPath(undefined, false)).toBe(
        "/custom-theme/acme/logo.svg",
      );
    });

    it("should return default path when no overrides are set", () => {
      expect(defaultThemeConfig.getLogoPath(undefined, false)).toBe(
        "/custom-theme/logo.svg",
      );
    });

    it("should fall through to themePath when only dark env var is set but light is requested", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themeLogoDarkPath: "/custom/dark-logo.svg",
          themePath: "/themes/company",
        }),
      );

      // Should NOT use dark path for light mode, should fall through to themePath
      expect(defaultThemeConfig.getLogoPath(undefined, false)).toBe(
        "/themes/company/logo.svg",
      );
    });

    it("should respect full priority chain: env > themePath > themeCustomerName > default", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themeLogoPath: "/env/logo.svg",
          themePath: "/themes/company",
          themeCustomerName: "acme",
        }),
      );

      expect(defaultThemeConfig.getLogoPath(undefined, false)).toBe(
        "/env/logo.svg",
      );
    });

    it("should prioritize themePath over themeCustomerName when env not set", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themePath: "/themes/company",
          themeCustomerName: "acme",
        }),
      );

      expect(defaultThemeConfig.getLogoPath(undefined, false)).toBe(
        "/themes/company/logo.svg",
      );
    });
  });

  describe("getAssistantAvatarPath", () => {
    it("should return env path when set", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themeAssistantAvatarPath: "/custom/avatar.svg",
        }),
      );

      expect(defaultThemeConfig.getAssistantAvatarPath(undefined)).toBe(
        "/custom/avatar.svg",
      );
    });

    it("should return themePath-based path when themePath is set", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themePath: "/themes/company",
        }),
      );

      expect(defaultThemeConfig.getAssistantAvatarPath(undefined)).toBe(
        "/themes/company/assistant-avatar.svg",
      );
    });

    it("should return customer-specific path when themeCustomerName is set", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themeCustomerName: "acme",
        }),
      );

      expect(defaultThemeConfig.getAssistantAvatarPath(undefined)).toBe(
        "/custom-theme/acme/assistant-avatar.svg",
      );
    });

    it("should return null when no overrides are set", () => {
      expect(defaultThemeConfig.getAssistantAvatarPath(undefined)).toBeNull();
    });

    it("should respect full priority chain: env > themePath > themeCustomerName > null", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themeAssistantAvatarPath: "/env/avatar.svg",
          themePath: "/themes/company",
          themeCustomerName: "acme",
        }),
      );

      expect(defaultThemeConfig.getAssistantAvatarPath(undefined)).toBe(
        "/env/avatar.svg",
      );
    });

    it("should prioritize themePath over themeCustomerName when env not set", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themePath: "/themes/company",
          themeCustomerName: "acme",
        }),
      );

      expect(defaultThemeConfig.getAssistantAvatarPath(undefined)).toBe(
        "/themes/company/assistant-avatar.svg",
      );
    });
  });

  describe("getSidebarLogoPath", () => {
    it("should handle light and dark mode variants with env vars", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          sidebarLogoDarkPath: "/custom/sidebar-dark.svg",
          sidebarLogoPath: "/custom/sidebar-light.svg",
        }),
      );

      expect(defaultThemeConfig.getSidebarLogoPath(undefined, true)).toBe(
        "/custom/sidebar-dark.svg",
      );
      expect(defaultThemeConfig.getSidebarLogoPath(undefined, false)).toBe(
        "/custom/sidebar-light.svg",
      );
    });

    it("should handle dark mode with themePath", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themePath: "/themes/company",
        }),
      );

      expect(defaultThemeConfig.getSidebarLogoPath(undefined, true)).toBe(
        "/themes/company/sidebar-logo-dark.svg",
      );
      expect(defaultThemeConfig.getSidebarLogoPath(undefined, false)).toBe(
        "/themes/company/sidebar-logo.svg",
      );
    });

    it("should handle dark mode with themeCustomerName", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themeCustomerName: "acme",
        }),
      );

      expect(defaultThemeConfig.getSidebarLogoPath(undefined, true)).toBe(
        "/custom-theme/acme/sidebar-logo-dark.svg",
      );
      expect(defaultThemeConfig.getSidebarLogoPath(undefined, false)).toBe(
        "/custom-theme/acme/sidebar-logo.svg",
      );
    });

    it("should return env path when set", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          sidebarLogoPath: "/custom/sidebar-light.svg",
        }),
      );

      expect(defaultThemeConfig.getSidebarLogoPath(undefined, false)).toBe(
        "/custom/sidebar-light.svg",
      );
    });

    it("should return themePath-based path when themePath is set", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themePath: "/themes/company",
        }),
      );

      expect(defaultThemeConfig.getSidebarLogoPath(undefined, false)).toBe(
        "/themes/company/sidebar-logo.svg",
      );
    });

    it("should return customer-specific path when themeCustomerName is set", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themeCustomerName: "acme",
        }),
      );

      expect(defaultThemeConfig.getSidebarLogoPath(undefined, false)).toBe(
        "/custom-theme/acme/sidebar-logo.svg",
      );
    });

    it("should return null when no overrides are set", () => {
      expect(
        defaultThemeConfig.getSidebarLogoPath(undefined, false),
      ).toBeNull();
    });

    it("should fall through to themePath when only dark env var is set but light is requested", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          sidebarLogoDarkPath: "/custom/sidebar-dark.svg",
          themePath: "/themes/company",
        }),
      );

      expect(defaultThemeConfig.getSidebarLogoPath(undefined, false)).toBe(
        "/themes/company/sidebar-logo.svg",
      );
    });

    it("should respect full priority chain: env > themePath > themeCustomerName > null", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          sidebarLogoPath: "/env/sidebar-logo.svg",
          themePath: "/themes/company",
          themeCustomerName: "acme",
        }),
      );

      expect(defaultThemeConfig.getSidebarLogoPath(undefined, false)).toBe(
        "/env/sidebar-logo.svg",
      );
    });

    it("should prioritize themePath over themeCustomerName when env not set", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themePath: "/themes/company",
          themeCustomerName: "acme",
        }),
      );

      expect(defaultThemeConfig.getSidebarLogoPath(undefined, false)).toBe(
        "/themes/company/sidebar-logo.svg",
      );
    });
  });

  describe("getThemePaths", () => {
    it("should return all paths in correct priority order with no env vars", () => {
      const result = defaultThemeConfig.getThemePaths();
      expect(result).toEqual([
        null, // themeConfigPath
        null, // themeCustomerName
        null, // themePath
        "/custom-theme/theme.json",
      ]);
    });

    it("should return all paths with all env vars set in correct priority order", () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themeConfigPath: "/custom/theme.json",
          themeCustomerName: "acme",
          themePath: "/themes/company",
        }),
      );

      const result = defaultThemeConfig.getThemePaths();
      expect(result).toEqual([
        "/custom/theme.json",
        "/custom-theme/acme/theme.json",
        "/themes/company/theme.json",
        "/custom-theme/theme.json",
      ]);
    });
  });

  describe("loadThemeConfig", () => {
    const mockTheme: CustomThemeConfig = {
      name: "Test Theme",
      logo: {
        path: "/custom/logo.svg",
        darkPath: "/custom/logo-dark.svg",
      },
      theme: {}, // Empty theme is valid - light and dark are optional
    };

    beforeEach(() => {
      global.fetch = vi.fn();
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should load theme from first successful path", async () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themeConfigPath: "/custom/theme.json",
          themePath: "/themes/company",
        }),
      );

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTheme,
      });

      const result = await loadThemeConfig();

      expect(result).toEqual(mockTheme);
      expect(global.fetch).toHaveBeenCalledWith("/custom/theme.json");
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(console.log).toHaveBeenCalledWith(
        "Custom theme loaded: Test Theme from /custom/theme.json",
      );
    });

    it("should fallback to next path when first path returns 404", async () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themeConfigPath: "/custom/theme.json",
          themePath: "/themes/company",
        }),
      );

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: false,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTheme,
        });

      const result = await loadThemeConfig();

      expect(result).toEqual(mockTheme);
      expect(global.fetch).toHaveBeenCalledWith("/custom/theme.json");
      expect(global.fetch).toHaveBeenCalledWith("/themes/company/theme.json");
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(console.log).toHaveBeenCalledWith(
        "Custom theme loaded: Test Theme from /themes/company/theme.json",
      );
    });

    it("should handle fetch errors and try next path", async () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themeConfigPath: "/custom/theme.json",
          themePath: "/themes/company",
        }),
      );

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTheme,
        });

      const result = await loadThemeConfig();

      expect(result).toEqual(mockTheme);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(console.log).toHaveBeenCalledWith(
        "Theme not found at /custom/theme.json, trying next location",
      );
    });

    it("should return null when no theme is found", async () => {
      mockEnv.mockReturnValue(createMockEnv());

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
      });

      const result = await loadThemeConfig();

      expect(result).toBeNull();
      expect(console.log).toHaveBeenCalledWith(
        "No custom theme found, using default theme",
      );
    });

    it("should return null on JSON parsing error and continue to next path", async () => {
      mockEnv.mockReturnValue(
        createMockEnv({
          themeConfigPath: "/custom/theme.json",
          themePath: "/themes/company",
        }),
      );

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => {
            throw new Error("Invalid JSON");
          },
        })
        .mockResolvedValueOnce({
          ok: false,
        });

      const result = await loadThemeConfig();

      expect(result).toBeNull();
      expect(console.log).toHaveBeenCalledWith(
        "Theme not found at /custom/theme.json, trying next location",
      );
      expect(console.log).toHaveBeenCalledWith(
        "No custom theme found, using default theme",
      );
    });

    it("should use custom config when provided", async () => {
      const customConfig = {
        getThemePaths: () => ["/custom-config/theme.json"],
        getLogoPath: () => "/logo.svg",
        getAssistantAvatarPath: () => null,
        getSidebarLogoPath: () => null,
        getFontsCssPath: () => null,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTheme,
      });

      const result = await loadThemeConfig(customConfig);

      expect(result).toEqual(mockTheme);
      expect(global.fetch).toHaveBeenCalledWith("/custom-config/theme.json");
    });
  });

  describe("resolveIconPaths", () => {
    it("should return empty object when iconMappings is undefined", () => {
      const result = resolveIconPaths(undefined, "test-customer");
      expect(result).toEqual({});
    });

    it("should resolve relative paths with customer name", () => {
      const iconMappings = {
        fileTypes: {
          pdf: "./icons/custom-pdf.svg",
          image: "MediaImage",
        },
      };

      const result = resolveIconPaths(iconMappings, "trilux-test");

      expect(result.fileTypes?.pdf).toBe(
        "/custom-theme/trilux-test/icons/custom-pdf.svg",
      );
      expect(result.fileTypes?.image).toBe("MediaImage");
    });

    it("should use themePath env variable when available", () => {
      mockEnv.mockReturnValue(
        createMockEnv({ themePath: "/custom/theme/path" }),
      );

      const iconMappings = {
        status: {
          error: "./icons/error.svg",
          success: "CheckCircle",
        },
      };

      const result = resolveIconPaths(iconMappings, "customer");

      expect(result.status?.error).toBe("/custom/theme/path/icons/error.svg");
      expect(result.status?.success).toBe("CheckCircle");
    });

    it("should use themeCustomerName env variable when customerName is not provided", () => {
      mockEnv.mockReturnValue(
        createMockEnv({ themeCustomerName: "env-customer" }),
      );

      const iconMappings = {
        actions: {
          copy: "./icons/copy.svg",
        },
      };

      const result = resolveIconPaths(iconMappings, undefined);

      expect(result.actions?.copy).toBe(
        "/custom-theme/env-customer/icons/copy.svg",
      );
    });

    it("should handle absolute paths unchanged", () => {
      const iconMappings = {
        fileTypes: {
          pdf: "/absolute/path/icon.svg",
        },
      };

      const result = resolveIconPaths(iconMappings, "customer");

      expect(result.fileTypes?.pdf).toBe("/absolute/path/icon.svg");
    });

    it("should handle all icon categories", () => {
      const iconMappings = {
        fileTypes: { pdf: "./pdf.svg" },
        status: { error: "./error.svg" },
        actions: { copy: "./copy.svg" },
        navigation: { assistants: "./assistants.svg" },
      };

      const result = resolveIconPaths(iconMappings, "test");

      expect(result.fileTypes?.pdf).toBe("/custom-theme/test/pdf.svg");
      expect(result.status?.error).toBe("/custom-theme/test/error.svg");
      expect(result.actions?.copy).toBe("/custom-theme/test/copy.svg");
      expect(result.navigation?.assistants).toBe(
        "/custom-theme/test/assistants.svg",
      );
    });

    it("should fallback to default path when no customer info", () => {
      const iconMappings = {
        fileTypes: {
          video: "./icons/video.svg",
        },
      };

      const result = resolveIconPaths(iconMappings, undefined);

      expect(result.fileTypes?.video).toBe("/custom-theme/icons/video.svg");
    });
  });
});
