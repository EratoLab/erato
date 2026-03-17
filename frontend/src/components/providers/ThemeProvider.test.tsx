import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/env", () => ({
  env: vi.fn(),
}));

import { env } from "@/app/env";

import { THEME_MODE_LOCAL_STORAGE_KEY, ThemeProvider } from "./ThemeProvider";

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

const createMatchMedia = (matches: boolean): typeof window.matchMedia =>
  vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;

describe("ThemeProvider", () => {
  beforeEach(() => {
    mockEnv.mockReturnValue(createMockEnv());
    global.fetch = vi.fn();
    window.matchMedia = createMatchMedia(false);
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
    document.documentElement.removeAttribute("style");
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

  it("writes the explicit dark mode to documentElement data-theme", async () => {
    localStorage.setItem(THEME_MODE_LOCAL_STORAGE_KEY, "dark");

    render(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    });
  });

  it("writes the system dark mode to documentElement data-theme", async () => {
    const matchMedia = createMatchMedia(true);
    window.matchMedia = matchMedia;
    localStorage.setItem(THEME_MODE_LOCAL_STORAGE_KEY, "system");

    render(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    });

    expect(matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
  });

  it("writes the expanded token surface to CSS variables", async () => {
    mockEnv.mockReturnValue(
      createMockEnv({
        themeConfigPath: "/custom/brand/theme.json",
      }),
    );

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () =>
        ({
          ...mockTheme,
          theme: {
            light: {
              colors: {
                action: {
                  primary: {
                    background: "#312e81",
                    foreground: "#eef2ff",
                    hover: "#4338ca",
                  },
                },
                border: {
                  primary: "#c4b5fd",
                },
                shell: {
                  page: "#f5f3ff",
                  modal: "#ffffff",
                },
                message: {
                  assistant: "#ede9fe",
                },
                overlay: {
                  modal: "rgba(76, 29, 149, 0.32)",
                },
              },
              radius: {
                shell: "1.25rem",
              },
              elevation: {
                dropdown: "0 16px 32px rgba(15, 23, 42, 0.18)",
              },
              layout: {
                chat: {
                  inputMaxWidth: "60rem",
                },
                sidebar: {
                  width: "20rem",
                },
              },
            },
          },
        }) satisfies CustomThemeConfig,
    });

    render(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue("--theme-shell-page"),
      ).toBe("#f5f3ff");
    });

    expect(
      document.documentElement.style.getPropertyValue(
        "--theme-action-primary-bg",
      ),
    ).toBe("#312e81");
    expect(
      document.documentElement.style.getPropertyValue(
        "--theme-action-primary-fg",
      ),
    ).toBe("#eef2ff");
    expect(
      document.documentElement.style.getPropertyValue(
        "--theme-action-primary-hover",
      ),
    ).toBe("#4338ca");
    expect(
      document.documentElement.style.getPropertyValue("--theme-border-primary"),
    ).toBe("#c4b5fd");
    expect(
      document.documentElement.style.getPropertyValue("--theme-shell-modal"),
    ).toBe("#ffffff");
    expect(
      document.documentElement.style.getPropertyValue(
        "--theme-message-assistant",
      ),
    ).toBe("#ede9fe");
    expect(
      document.documentElement.style.getPropertyValue("--theme-overlay-modal"),
    ).toBe("rgba(76, 29, 149, 0.32)");
    expect(
      document.documentElement.style.getPropertyValue("--theme-radius-shell"),
    ).toBe("1.25rem");
    expect(
      document.documentElement.style.getPropertyValue(
        "--theme-elevation-dropdown",
      ),
    ).toBe("0 16px 32px rgba(15, 23, 42, 0.18)");
    expect(
      document.documentElement.style.getPropertyValue(
        "--theme-layout-chat-input-max-width",
      ),
    ).toBe("60rem");
    expect(
      document.documentElement.style.getPropertyValue(
        "--theme-layout-sidebar-width",
      ),
    ).toBe("20rem");
  });

  it("maps legacy theme fields into the expanded token surface", async () => {
    mockEnv.mockReturnValue(
      createMockEnv({
        themeConfigPath: "/custom/brand/theme.json",
      }),
    );

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () =>
        ({
          ...mockTheme,
          theme: {
            light: {
              borderRadius: "1rem",
              colors: {
                background: {
                  primary: "#f5f7f4",
                  secondary: "#edf2ee",
                  tertiary: "#e4ebe5",
                  sidebar: "#eff4ef",
                  hover: "#dde7df",
                  selected: "#d4e3d7",
                },
                border: {
                  default: "#cfddd1",
                },
                messageItem: {
                  hover: "#c8d9cc",
                },
              },
            },
          },
        }) satisfies CustomThemeConfig,
    });

    render(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue("--theme-shell-page"),
      ).toBe("#edf2ee");
    });

    expect(
      document.documentElement.style.getPropertyValue(
        "--theme-shell-chat-input",
      ),
    ).toBe("#e4ebe5");
    expect(
      document.documentElement.style.getPropertyValue(
        "--theme-shell-sidebar-selected",
      ),
    ).toBe("#d4e3d7");
    expect(
      document.documentElement.style.getPropertyValue("--theme-message-hover"),
    ).toBe("#c8d9cc");
    expect(
      document.documentElement.style.getPropertyValue("--theme-border-primary"),
    ).toBe("#cfddd1");
    expect(
      document.documentElement.style.getPropertyValue("--theme-border-subtle"),
    ).toBe("#cfddd1");
    expect(
      document.documentElement.style.getPropertyValue("--theme-radius-shell"),
    ).toBe("1rem");
  });
});
