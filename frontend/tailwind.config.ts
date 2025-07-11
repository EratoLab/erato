import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Geist Variable", ...defaultTheme.fontFamily.sans],
        mono: ["Geist Mono Variable", ...defaultTheme.fontFamily.mono],
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
          border: {
            DEFAULT: "var(--theme-border)",
            primary: "var(--theme-border-primary)",
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
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
