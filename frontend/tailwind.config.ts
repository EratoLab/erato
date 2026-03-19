import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--theme-font-body, 'Geist Variable')",
          ...defaultTheme.fontFamily.sans,
        ],
        heading: [
          "var(--theme-font-heading, 'Geist Variable')",
          ...defaultTheme.fontFamily.sans,
        ],
        "body-semibold": [
          "var(--theme-font-semibold, var(--theme-font-body, 'Geist Variable'))",
          ...defaultTheme.fontFamily.sans,
        ],
        "heading-bold": [
          "var(--theme-font-heading-bold, var(--theme-font-heading, 'Geist Variable'))",
          ...defaultTheme.fontFamily.sans,
        ],
        mono: [
          "var(--theme-font-mono, 'Geist Mono Variable')",
          ...defaultTheme.fontFamily.mono,
        ],
      },
      fontSize: {
        xs: [
          "var(--theme-font-size-xs)",
          {
            lineHeight: "var(--theme-line-height-xs)",
            letterSpacing: "var(--theme-letter-spacing-xs)",
          },
        ],
        sm: [
          "var(--theme-font-size-sm)",
          {
            lineHeight: "var(--theme-line-height-sm)",
            letterSpacing: "var(--theme-letter-spacing-sm)",
          },
        ],
        base: [
          "var(--theme-font-size-base)",
          {
            lineHeight: "var(--theme-line-height-base)",
            letterSpacing: "var(--theme-letter-spacing-base)",
          },
        ],
        lg: [
          "var(--theme-font-size-lg)",
          {
            lineHeight: "var(--theme-line-height-lg)",
            letterSpacing: "var(--theme-letter-spacing-lg)",
          },
        ],
        xl: [
          "var(--theme-font-size-xl)",
          {
            lineHeight: "var(--theme-line-height-xl)",
            letterSpacing: "var(--theme-letter-spacing-xl)",
          },
        ],
        "2xl": [
          "var(--theme-font-size-2xl)",
          {
            lineHeight: "var(--theme-line-height-2xl)",
            letterSpacing: "var(--theme-letter-spacing-2xl)",
          },
        ],
      },
      fontWeight: {
        normal: "var(--theme-font-weight-normal)",
        medium: "var(--theme-font-weight-medium)",
        semibold: "var(--theme-font-weight-semibold)",
        bold: "var(--theme-font-weight-bold)",
      },
      colors: {
        theme: {
          bg: {
            primary: "var(--theme-bg-primary)",
            secondary: "var(--theme-bg-secondary)",
            tertiary: "var(--theme-bg-tertiary)",
            sidebar: "var(--theme-bg-sidebar)",
            accent: "var(--theme-bg-accent)",
            hover: "var(--theme-bg-hover)",
            selected: "var(--theme-bg-selected)",
          },
          fg: {
            primary: "var(--theme-fg-primary)",
            secondary: "var(--theme-fg-secondary)",
            muted: "var(--theme-fg-muted)",
            accent: "var(--theme-fg-accent)",
          },
          action: {
            primary: {
              bg: "var(--theme-action-primary-bg)",
              fg: "var(--theme-action-primary-fg)",
              hover: "var(--theme-action-primary-hover)",
            },
          },
          border: {
            DEFAULT: "var(--theme-border)",
            primary: "var(--theme-border-primary, var(--theme-border))",
            strong: "var(--theme-border-strong)",
            focus: "var(--theme-border-focus)",
          },
          avatar: {
            user: {
              bg: "var(--theme-avatar-user-bg)",
              fg: "var(--theme-avatar-user-fg)",
            },
            assistant: {
              bg: "var(--theme-avatar-assistant-bg)",
              fg: "var(--theme-avatar-assistant-fg)",
            },
          },
          code: {
            inline: {
              bg: "var(--theme-code-inline-bg)",
              fg: "var(--theme-code-inline-fg)",
              border: "var(--theme-code-inline-border)",
            },
            block: {
              bg: "var(--theme-code-block-bg)",
              fg: "var(--theme-code-block-fg)",
              border: "var(--theme-code-block-border)",
            },
          },
          info: {
            fg: "var(--theme-info-fg)",
            bg: "var(--theme-info-bg)",
            border: "var(--theme-info-border)",
          },
          success: {
            fg: "var(--theme-success-fg)",
            bg: "var(--theme-success-bg)",
            border: "var(--theme-success-border)",
          },
          warning: {
            fg: "var(--theme-warning-fg)",
            bg: "var(--theme-warning-bg)",
            border: "var(--theme-warning-border)",
          },
          error: {
            fg: "var(--theme-error-fg)",
            bg: "var(--theme-error-bg)",
            border: "var(--theme-error-border)",
          },
          focus: {
            ring: "var(--theme-focus-ring)",
          },
        },
      },
      ringColor: {
        theme: {
          focus: "var(--theme-focus-ring)",
          "focus-error": "var(--theme-focus-ring-error)",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
