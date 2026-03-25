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
  msalClientId: null,
  msalAuthority: null,
  disableUpload: false,
  disableChatInputAutofocus: false,
  disableLogout: false,
  assistantsEnabled: false,
  assistantsShowRecentItems: false,
  assistantContextWarningThreshold: 0.5,
  assistantContextFileContributorThreshold: 0.05,
  starterPromptsEnabled: false,
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
        'link[data-theme-fonts="true"], link[data-theme-styles="true"], style[data-theme-vars="true"]',
      )
      .forEach((node) => node.remove());
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

    await waitFor(() => {
      expect(
        document.querySelector('style[data-theme-vars="true"]'),
      ).not.toBeNull();
    });

    expect(
      document.querySelector('link[data-theme-styles="true"]'),
    ).toHaveAttribute("href", "/custom/brand/theme.css");

    const stylesheetMarkers = Array.from(
      document.head.querySelectorAll(
        'link[data-theme-fonts="true"], style[data-theme-vars="true"], link[data-theme-styles="true"]',
      ),
    ).map((node) =>
      node instanceof HTMLLinkElement
        ? node.hasAttribute("data-theme-fonts")
          ? "fonts"
          : "theme"
        : "vars",
    );

    expect(stylesheetMarkers).toEqual(["fonts", "vars", "theme"]);

    unmount();

    expect(document.querySelector('link[data-theme-fonts="true"]')).toBeNull();
    expect(document.querySelector('link[data-theme-styles="true"]')).toBeNull();
    expect(document.querySelector('style[data-theme-vars="true"]')).toBeNull();
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
                focus: {
                  errorRing: "rgba(127, 29, 29, 0.24)",
                },
                message: {
                  assistant: "#ede9fe",
                },
                code: {
                  inline: {
                    background: "#eef2ff",
                    foreground: "#312e81",
                    border: "#c7d2fe",
                  },
                  block: {
                    background: "#ffffff",
                    foreground: "#1e1b4b",
                    border: "#c7d2fe",
                  },
                  syntax: {
                    keyword: "#4338ca",
                    string: "#047857",
                  },
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
              spacing: {
                dropdown: {
                  chromePaddingY: "0.375rem",
                },
                modal: {
                  closeButtonPadding: "0.375rem",
                },
              },
              layout: {
                chat: {
                  inputMaxWidth: "60rem",
                },
                dropdown: {
                  minWidth: "14rem",
                  viewportMargin: "12px",
                },
                modal: {
                  backdropBlur: "6px",
                  maxHeight: "85vh",
                  maxWidth: "44rem",
                  viewportMargin: "1.5rem",
                },
                sidebar: {
                  width: "20rem",
                },
              },
              typography: {
                fontFamily: {
                  heading: "IBM Plex Sans",
                  mono: "IBM Plex Mono",
                },
                fontSize: {
                  base: "1.0625rem",
                },
                lineHeight: {
                  base: "1.625rem",
                },
                letterSpacing: {
                  xl: "-0.02em",
                },
                fontWeight: {
                  semibold: "650",
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

    const getThemeVarsStyle = () =>
      document.querySelector<HTMLStyleElement>('style[data-theme-vars="true"]');

    await waitFor(() => {
      expect(getThemeVarsStyle()?.textContent).toContain(
        "--theme-shell-page: #f5f3ff;",
      );
    });

    const varsCss = getThemeVarsStyle()?.textContent ?? "";

    expect(varsCss).toContain("--theme-action-primary-bg: #312e81;");
    expect(varsCss).toContain("--theme-action-primary-fg: #eef2ff;");
    expect(varsCss).toContain("--theme-action-primary-hover: #4338ca;");
    expect(varsCss).toContain("--theme-border-primary: #c4b5fd;");
    expect(varsCss).toContain("--theme-border-field: #d1d5db;");
    expect(varsCss).toContain("--theme-border-field-focus: #6b7280;");
    expect(varsCss).toContain("--theme-border-chat-input: #d1d5db;");
    expect(varsCss).toContain("--theme-border-chat-input-focus: #6b7280;");
    expect(varsCss).toContain("--theme-border-dropdown: #d1d5db;");
    expect(varsCss).toContain("--theme-border-media: #d1d5db;");
    expect(varsCss).toContain("--theme-border-attachment: #d1d5db;");
    expect(varsCss).toContain("--theme-shell-modal: #ffffff;");
    expect(varsCss).toContain(
      "--theme-focus-ring-error: rgba(127, 29, 29, 0.24);",
    );
    expect(varsCss).toContain("--theme-message-assistant: #ede9fe;");
    expect(varsCss).toContain("--theme-code-inline-bg: #eef2ff;");
    expect(varsCss).toContain("--theme-code-inline-fg: #312e81;");
    expect(varsCss).toContain("--theme-code-inline-border: #c7d2fe;");
    expect(varsCss).toContain("--theme-code-block-bg: #ffffff;");
    expect(varsCss).toContain("--theme-code-block-fg: #1e1b4b;");
    expect(varsCss).toContain("--theme-code-block-border: #c7d2fe;");
    expect(varsCss).toContain("--theme-code-syntax-keyword: #4338ca;");
    expect(varsCss).toContain("--theme-code-syntax-string: #047857;");
    expect(varsCss).toContain(
      "--theme-overlay-modal: rgba(76, 29, 149, 0.32);",
    );
    expect(varsCss).toContain("--theme-radius-shell: 1.25rem;");
    expect(varsCss).toContain(
      "--theme-elevation-dropdown: 0 16px 32px rgba(15, 23, 42, 0.18);",
    );
    expect(varsCss).toContain(
      "--theme-spacing-dropdown-chrome-padding-y: 0.375rem;",
    );
    expect(varsCss).toContain(
      "--theme-spacing-modal-close-button-padding: 0.375rem;",
    );
    expect(varsCss).toContain("--theme-layout-chat-input-max-width: 60rem;");
    expect(varsCss).toContain("--theme-layout-dropdown-min-width: 14rem;");
    expect(varsCss).toContain("--theme-layout-dropdown-viewport-margin: 12px;");
    expect(varsCss).toContain("--theme-layout-modal-backdrop-blur: 6px;");
    expect(varsCss).toContain("--theme-layout-modal-max-height: 85vh;");
    expect(varsCss).toContain("--theme-layout-modal-max-width: 44rem;");
    expect(varsCss).toContain("--theme-layout-modal-viewport-margin: 1.5rem;");
    expect(varsCss).toContain("--theme-layout-sidebar-width: 20rem;");
    expect(varsCss).toContain("--theme-font-heading: IBM Plex Sans;");
    expect(varsCss).toContain("--theme-font-mono: IBM Plex Mono;");
    expect(varsCss).toContain("--theme-font-size-base: 1.0625rem;");
    expect(varsCss).toContain("--theme-line-height-base: 1.625rem;");
    expect(varsCss).toContain("--theme-letter-spacing-xl: -0.02em;");
    expect(varsCss).toContain("--theme-font-weight-semibold: 650;");
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

    const getThemeVarsStyle = () =>
      document.querySelector<HTMLStyleElement>('style[data-theme-vars="true"]');

    await waitFor(() => {
      expect(getThemeVarsStyle()?.textContent).toContain(
        "--theme-shell-page: #edf2ee;",
      );
    });

    const varsCss = getThemeVarsStyle()?.textContent ?? "";

    expect(varsCss).toContain("--theme-shell-chat-input: #e4ebe5;");
    expect(varsCss).toContain("--theme-shell-sidebar-selected: #d4e3d7;");
    expect(varsCss).toContain("--theme-message-hover: #c8d9cc;");
    expect(varsCss).toContain("--theme-border-primary: #cfddd1;");
    expect(varsCss).toContain("--theme-border-subtle: #cfddd1;");
    expect(varsCss).toContain("--theme-border-field: #cfddd1;");
    expect(varsCss).toContain("--theme-border-chat-input: #cfddd1;");
    expect(varsCss).toContain("--theme-border-dropdown: #d1d5db;");
    expect(varsCss).toContain("--theme-border-media: #d1d5db;");
    expect(varsCss).toContain("--theme-border-attachment: #cfddd1;");
    expect(varsCss).toContain("--theme-border-field-focus: #6b7280;");
    expect(varsCss).toContain("--theme-border-chat-input-focus: #6b7280;");
    expect(varsCss).toContain("--theme-radius-shell: 1rem;");
  });
});
