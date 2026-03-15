import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/env", () => ({
  env: vi.fn(),
}));

vi.mock("@/components/ui/ThemeApplier", () => ({
  ThemeApplier: () => null,
}));

// eslint-disable-next-line import/order
import { env } from "@/app/env";

import { ThemeProvider } from "./ThemeProvider";

import type { Env } from "@/app/env";
import type { CustomThemeConfig } from "@/utils/themeUtils";

const mockEnv = env as ReturnType<typeof vi.fn>;

const createMockEnv = (overrides: Partial<Env> = {}): Env => ({
  apiRootUrl: "http://localhost:3000",
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
  promptOptimizerEnabled: false,
  sharepointEnabled: false,
  messageFeedbackEnabled: false,
  messageFeedbackCommentsEnabled: false,
  userPreferencesEnabled: true,
  messageFeedbackEditTimeLimitSeconds: null,
  maxUploadSizeBytes: 20971520,
  sidebarCollapsedMode: "hidden",
  sidebarLogoPath: null,
  sidebarLogoDarkPath: null,
  sidebarChatHistoryShowMetadata: true,
  ...overrides,
});

const mockTheme: CustomThemeConfig = {
  name: "Test Theme",
  theme: {},
};

describe("ThemeProvider", () => {
  beforeEach(() => {
    mockEnv.mockReturnValue(createMockEnv());
    global.fetch = vi.fn();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    document
      .querySelectorAll(
        'link[data-theme-fonts="true"], link[data-theme-styles="true"]',
      )
      .forEach((link) => link.remove());
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-name");
  });

  it("loads sibling fonts.css and theme.css beside the resolved theme.json path", async () => {
    mockEnv.mockReturnValue(
      createMockEnv({
        themeConfigPath: "/custom/brand/theme.json",
      }),
    );

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockTheme,
    });

    const { unmount } = render(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(
        document.querySelector('link[data-theme-fonts="true"]'),
      ).toHaveAttribute("href", "/custom/brand/fonts.css");
    });

    expect(
      document.querySelector('link[data-theme-styles="true"]'),
    ).toHaveAttribute("href", "/custom/brand/theme.css");

    const stylesheetMarkers = Array.from(
      document.head.querySelectorAll(
        'link[data-theme-fonts="true"], link[data-theme-styles="true"]',
      ),
    ).map((link) =>
      link.hasAttribute("data-theme-fonts") ? "fonts" : "theme",
    );

    expect(stylesheetMarkers).toEqual(["fonts", "theme"]);

    unmount();

    expect(document.querySelector('link[data-theme-fonts="true"]')).toBeNull();
    expect(document.querySelector('link[data-theme-styles="true"]')).toBeNull();
  });

  it("derives stylesheet paths from the theme.json path that actually loaded after fallback", async () => {
    mockEnv.mockReturnValue(
      createMockEnv({
        themeConfigPath: "/broken/theme.json",
        themePath: "/themes/customer",
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

    render(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(
        document.querySelector('link[data-theme-fonts="true"]'),
      ).toHaveAttribute("href", "/themes/customer/fonts.css");
    });

    expect(
      document.querySelector('link[data-theme-styles="true"]'),
    ).toHaveAttribute("href", "/themes/customer/theme.css");
    expect(global.fetch).toHaveBeenNthCalledWith(1, "/broken/theme.json");
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "/themes/customer/theme.json",
    );
  });
});
